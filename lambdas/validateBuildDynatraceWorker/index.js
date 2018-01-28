var AWS = require('aws-sdk');
var dtApiUtils = require('dtapiutils');
var monspecUtils = require('monspec');
var cputils = require('codepipelineutils');

var DYNAMODBTABLE = "BuildValidationRequests";
var REQUEST_STATUS_WAITING = "waiting";
var REQUEST_STATUS_VIOLATION = monspecUtils.MONSPEC_VIOLATION_STATUS_VIOLATION;
var REQUEST_STATUS_OK = monspecUtils.MONSPEC_VIOLATION_STATUS_OK;

// this function will most likely be triggered through a scheuled CloudWatch Event but can also be launched manually
// the function will poll the Dynatrace DynamoDB Table BuildValidationRequests and checks whether any new request is available for processing!
exports.handler = (event, context, callback) => {
    
    dtApiUtils.dtApiInit(function(err, data) {
        if(err) {
            console("dtApiInit failed: " + err);
            callback(err, "Execution Failed!")
            return;
        }
        
        // lets poll DyamoDB and see if there is a request that is ready for validation!
        var ddb = new AWS.DynamoDB();
        var timestamp = Date.now();
        
        var params = {
            ExpressionAttributeValues: {
                ':status': {S: REQUEST_STATUS_WAITING},
                ':timestamp' : {N: timestamp.toString()}
            },
            ExpressionAttributeNames: {
                "#request_status": "Status"
            },
        
            FilterExpression: '#request_status = :status AND ReadyToValidateTimestamp < :timestamp',
            TableName: DYNAMODBTABLE,
            Select : 'ALL_ATTRIBUTES'
        };
        
        // lets execute the query!
        ddb.scan(params, function(err, data) {
            if (err) { 
                console.log("Error", err); 
                callback(err, null);
                return;
            }
            
            if(data.Items.length == 0) {
                console.log("No requests in state waiting found in DynamoDB Table");
                callback(null, "Nothing to process");
                return;
            }
            
            // lets iterate through every open build validation request!
            data.Items.forEach(function(dynamoDBRequestItem) {
                processBuildValidationItem(dynamoDBRequestItem, function(err, monspec, violationCount) {
                    // if we have a processed monspec object we can now #1 store it back to DynamoDB, #2 update any CodePipeline approvals
                    if(err) {callback(err, null);return;}
                    
                    // #1 store in DynamoDB
                    console.log("Updating DynamoDB Entry with new status & filled monspec")
                    updateDynamoDBRequest(dynamoDBRequestItem, monspec, violationCount, function(err, data) {
                        if(err) {
                            console.log("Error updating DynamoDB");
                            callback(err, null); return;
                        }
                    });
                    
                    // #2 check whether there is a codepipeline approval action waiting!
                    cputils.findPipelineApprovalActionInProgress(dynamoDBRequestItem.PipelineName.S, dynamoDBRequestItem.PipelineAction.S, function(err, data) {
                        if(err) {
                            console.log("Error when finding approval action: " + err);
                            callback(err, null);return;
                        }

                        // lets approve the job
                        if(data) {
                            // console.log("Found a Pipeline Step to approve: " + JSON.stringify(data));

                            var validationResult = {};
                            
                            // construct the link to the build overview API Gateway Call
                            var reportLink = dtApiUtils.getDtBuildReportUrl() + "?pipelineName=" + dynamoDBRequestItem.PipelineName.S + "&comparisonName=" + dynamoDBRequestItem.ComparisonName.S + "&json=false";

                            if (violationCount == 0) {
                                validationResult.status = "Approved";
                                validationResult.summary = "All Performance Signatures validated successfully. Final results in DynamoDB or accessible through this link: " + reportLink;
                            } else {
                                validationResult.status = "Rejected";
                                validationResult.summary = violationCount + " Performance Signature violation(s) found. Please check the results in DynamoDB or check this link: " +  reportLink;
                            }

                            cputils.putApprovalResult(
                                data, 
                                validationResult, 
                                null, function(err, data) {
                                    if(err) {
                                        console.log("error while approving action: " + err);
                                        callback(err, null); return;
                                    }
                                }
                            );
                        }
                    });
                });
            });
            
            return;
        });    
    });
};

// is processing one build validation request stored in DynamoDB
var processBuildValidationItem = function(dynamoDBRequestItem, callback) {
    // in DynamoDB each column is an object where the first object is the datatype, e.g: S
    console.log("Start processing DynamoDB Item " + dynamoDBRequestItem.PipelineName.S + "/" + dynamoDBRequestItem.Timestamp.N);
    var monspecToProcess = JSON.parse(dynamoDBRequestItem.Monspec.S);
    
    // lets process the monspec definition based on the configured timeframe
    processMonspec(monspecToProcess, dynamoDBRequestItem.Timestamp.N, dynamoDBRequestItem.ReadyToValidateTimestamp.N, dynamoDBRequestItem.ComparisonName.S, function(err, data) {
        if(err) {callback(err, null);console.log("processMospec returned! " + err);return;}
        
        // set the comparision name we used!
        monspecToProcess[monspecUtils.FILLTASK_FIELD_RESOLVED_COMPARISON] = dynamoDBRequestItem.ComparisonName.S;
        
        // check whether we have any violations! - this will impact overall status we write back to DynamoDB
        var violationCount = monspecUtils.getNumberOfViolatedConfigurations(monspecToProcess);
        callback(err, monspecToProcess, violationCount);
    });
}

// updates DynamoDB item
var updateDynamoDBRequest = function(dynamoDBRequestItem, monspecToProcess, violationCount, callback) {
    console.log("Successfully processed DynamoDb Item " + dynamoDBRequestItem.PipelineName.S + "/" + dynamoDBRequestItem.Timestamp.N + " - time to write results back");
    
    // we are now updating the DynamoDB Item
    var newstatus = violationCount == 0 ? monspecUtils.MONSPEC_VIOLATION_STATUS_OK : monspecUtils.MONSPEC_VIOLATION_STATUS_VIOLATION;
    var newstatusmsg = violationCount == 0 ? " " : violationCount + " configuration entries showed violations!";
    var updatedmonspec = JSON.stringify(monspecToProcess);
    var params = {
        TableName: DYNAMODBTABLE,
        Key:{
            "PipelineName": { S: dynamoDBRequestItem.PipelineName.S },
            "Timestamp" : { N: dynamoDBRequestItem.Timestamp.N }
        },
        ExpressionAttributeNames: {
            "#request_status": "Status"
        },
        UpdateExpression: "set Monspec=:updatedmonspec, #request_status=:ns, Statusmsg=:nsmsg",
        ExpressionAttributeValues:{
            ":updatedmonspec": { S: updatedmonspec },
            ":ns": { S: newstatus },
            ":nsmsg": { S: newstatusmsg }
        },
        ReturnValues:"UPDATED_NEW"
    };

    // now we update the item in DynamoDB
    var ddb = new AWS.DynamoDB();
    ddb.updateItem(params, function(err, data) {
        console.log(err + data);
        if (err) { 
            console.log("Error", err); 
            callback(err, null);
            return;
        }
        
        callback(null, "OK");
    });
}

/**
 * Helper functions that iterates through multiple dataPoints returned byy Dynatrace Timeseries API and returns total sum, count and average
 */ 
var calculateAverageOnDataPoints = function(dataPoints) {
    var returnValue = {
        totalSum : 0,
        totalEntries : 0,
        totalAvg : 0
    };
    for(var dataPointEntity in dataPoints) {
        var dataPointForOneEntity = dataPoints[dataPointEntity];
        if(dataPointForOneEntity.length > 0) {
            returnValue.totalEntries++;
            returnValue.totalSum = returnValue.totalSum + dataPointForOneEntity[0][1];
        }
    }
    
    if (returnValue.totalEntries > 0) {
        returnValue.totalAvg = returnValue.totalSum / returnValue.totalEntries;
    } else {
        returnValue.totalAvg = null;
        returnValue.totalSum = null;
    }
    return returnValue;
}

// iterates over the monspec file and fills it with LIVE data from Dynatrace, e.g. acutal EntityIds that match tags and actual value for each timeseries
/**
 * 
 * @param {object} monspec
 *  the monspec object
 * @param {Integer} fromtime
 *  timestamp -> will be applied to source
 * @param {Integer} totime
 *  to timesatemp -> will be applied to source. Timespan (=totime-fromtime) will also be applied to compare data source
 * @param {String} comparisonname
 *  referneces the comparison definition in the monspec file
 */
var processMonspec = function(monspec, fromtime, totime, comparisonname, callback) {

    monspecUtils.getNextMonspecFillTask(monspec, function(nextMonspecFillTask) {
        if(nextMonspecFillTask == null) {
            callback(null, "DONE without errors!");
            return;
        }
        
        // now lets execute our task
        switch(nextMonspecFillTask.task) {
            case monspecUtils.FILLTASK_RESOLVE_ENTITIES:
                var entitydef = monspec[nextMonspecFillTask.configName];

                // first we need to figure out what our source and compare enviornment is
                var comparisonConfig = monspecUtils.getComparisonConfiguration(entitydef, comparisonname);
                if(comparisonConfig == null) {
                    console.log(comparisonname + " is no valid comparison configuration name. couldnt find it in monspec for " + nextMonspecFillTask.configName);
                    callback(comparisonname + " is no valid comparison configuration name. couldnt find it in monspec for " + nextMonspecFillTask.configName, null);
                    return;
                }
                
                // now lets resolve the tags in source and compare. We also have to take the "shifttimeframe" into account
                console.log("Resolving Entites for " + nextMonspecFillTask.configName + " and comparison " + comparisonname);
                var shifttimeframe = comparisonConfig.hasOwnProperty("shiftsourcetimeframe") ? comparisonConfig.shiftsourcetimeframe * 1000 : 0;
                dtApiUtils.queryEntities(entitydef.etype.toLowerCase(), entitydef.environments[comparisonConfig.source].tags, fromtime - shifttimeframe, totime - shifttimeframe, false, function(err, data) {
                    if(err) {
                        callback(err, null); 
                        return;
                    }
                        
                    // write the found entities back into the _resolved_entities property - we first set an empty object and then add each resolved enntity for both environments (source & compare)
                    entitydef[monspecUtils.FILLTASK_FIELD_RESOLVED_ENTITIES] = {};
                    entitydef[monspecUtils.FILLTASK_FIELD_RESOLVED_ENTITIES][comparisonConfig.source] = data;

                    /*Object.defineProperty(entitydef, monspecUtils.FILLTASK_FIELD_RESOLVED_ENTITIES, new Object());
                    Object.defineProperty(, comparisonConfig.source, data);*/
                    
                    // now we do the same for the compare source in case the compare source is different
                    if(comparisonConfig.source === comparisonConfig.compare) {
                        // compare === source -> so we just go on as we are done here
        
                        // now call the next task
                        processMonspec(monspec, fromtime, totime, comparisonname, callback);
                    } else {
                        // we have to calculate from/to timeframe for the comparison source
                        shifttimeframe = comparisonConfig.hasOwnProperty("shiftcomparetimeframe") ? comparisonConfig.shiftcomparetimeframe * 1000 : 0;
                        dtApiUtils.queryEntities(entitydef.etype.toLowerCase(), entitydef.environments[comparisonConfig.compare].tags, fromtime - shifttimeframe, totime - shifttimeframe, false, function(err, data) {
                            if(err) {
                                callback(err, null); 
                                return;
                            }
                                
                            // write the found entities back into the _resolved_entities property
                            entitydef[monspecUtils.FILLTASK_FIELD_RESOLVED_ENTITIES][comparisonConfig.compare] = data;

                            // now lets go on with the next step
                            processMonspec(monspec, fromtime, totime, comparisonname, callback);
                        });                  
                    }
                });                          
                break;
            case monspecUtils.FILLTASK_RESOLVE_PERFSIG:
                var entitydef = monspec[nextMonspecFillTask.configName];
                var entities = nextMonspecFillTask.entities;
                var perfSigEntry = nextMonspecFillTask.perfSigEntry;

                var comparisonConfig = monspecUtils.getComparisonConfiguration(entitydef, comparisonname);
                if(comparisonConfig == null) {
                    console.log(comparisonname + " is no valid comparison configuration name. couldnt find it in monspec for " + nextMonspecFillTask.configName);
                    callback(comparisonname + " is no valid comparison configuration name. couldnt find it in monspec for " + nextMonspecFillTask.configName, null);
                    return;
                }

                // we need to resolve both source and compare-source timeseries data - then compare these values
                console.log("Resolve PerfSig for " + perfSigEntry.timeseries + " on " + comparisonConfig.source);
                
                // lets first check if we actually have entities resolved for our "source"
                if(!entities[comparisonConfig.source] || entities[comparisonConfig.source].length == 0) {
                    console.log("No Entities resolved for Source in " + comparisonConfig.source);
                    callback("No Entities resolved for Source in " + comparisonConfig.source, null);
                    return;
                }
                
                var shifttimeframe = comparisonConfig.hasOwnProperty("shiftsourcetimeframe") ? comparisonConfig.shiftsourcetimeframe * 1000 : 0;
                dtApiUtils.getTimeseries(perfSigEntry.timeseries, entities[comparisonConfig.source], fromtime - shifttimeframe, totime - shifttimeframe, "total", perfSigEntry.aggregate, function(err, sourceData) {
                    if(err) {callback(err,null); return;}
                    
                    console.log("Actual values received from SOURCE for " + perfSigEntry.timeseries + ": " + JSON.stringify(sourceData.result.dataPoints) + " entities: " + entities[comparisonConfig.source]);
                    
                    // lets check if we received any values - otherwise we stop here
                    
                    var sourceResultData = calculateAverageOnDataPoints(sourceData.result.dataPoints);
                    console.log("TotalSourceResult: " + JSON.stringify(sourceResultData));
                    if(sourceResultData.sumEntries == 0) {
                        console.log("Didnt receive any values from SOURCE for " + perfSigEntry.timeseries);
                        callback("Didnt receive any values from SOURCE for " + perfSigEntry.timeseries);
                        return;
                    }
                    
                    // get the actual value from the timeserieresapi response!
                    perfSigEntry.actualSourceValue = sourceResultData.totalAvg;
                    
                    // now we have to retrieve it from compare if compare is specified
                    if(comparisonConfig.compare) {
                        // lets check if we actually have a comparison source
                        if(!entities[comparisonConfig.compare] || entities[comparisonConfig.compare].length == 0) {
                            // we didnt find our compare entities! so we simply set the value to null
                            perfSigEntry.actualCompareValue = null;
                            
                            // now lets check the entry for violations    
                            monspecUtils.checkPerfSigEntryViolation(entitydef, perfSigEntry, comparisonConfig, true);
                            
                            // now call the next task
                            processMonspec(monspec, fromtime, totime, comparisonname, callback);
                        }
                        else {
                            var shifttimeframe = comparisonConfig.hasOwnProperty("shiftcomparetimeframe") ? comparisonConfig.shiftcomparetimeframe * 1000 : 0;
                            dtApiUtils.getTimeseries(perfSigEntry.timeseries, entities[comparisonConfig.compare], fromtime - shifttimeframe, totime - shifttimeframe, "total", perfSigEntry.aggregate, function(err, compareData) {
                                if(err) {callback(err,null); return;}
                                
                                console.log("Actual values received from COMPARE for " + perfSigEntry.timeseries + ": " + JSON.stringify(compareData.result.dataPoints));

                                var compareResultData = calculateAverageOnDataPoints(compareData.result.dataPoints);
                                console.log("TotalCompareResult: " + JSON.stringify(compareResultData));

                                if(compareResultData.sumEntries == 0) {
                                    console.log("Didnt receive any values from COMPARE for " + perfSigEntry.timeseries);
                                    callback("Didnt receive any values from COMPARE for " + perfSigEntry.timeseries);
                                    return;
                                }

                                // get the actual value from the timeserieresapi response!
                                perfSigEntry.actualCompareValue = compareResultData.totalAvg;

                                // now lets check the entry for violations    
                                monspecUtils.checkPerfSigEntryViolation(entitydef, perfSigEntry, comparisonConfig, true);
                            
                                // now call the next task
                                processMonspec(monspec, fromtime, totime, comparisonname, callback);
                            });
                        }
                    } else {
                        // in this case we assume that monspec contains hard coded static thresholds 
                        monspecUtils.checkPerfSigEntryViolation(entitydef, perfSigEntry, comparisonConfig, true);
                    
                        // now call the next task
                        processMonspec(monspec, fromtime, totime, comparisonname, callback);
                    }
                });
                break;
            case monspecUtils.FILLTASK_RESOLVE_SERVICE_PERFSIG:
                // TODO - for later - right now we just put the desired value in the actual value
                var entitydef = monspec[nextMonspecFillTask.configName];
                var entities = nextMonspecFillTask.entities;
                var perfSigEntry = nextMonspecFillTask.perfSigEntry;
                var serviceName = nextMonspecFillTask.serviceName;
                
                // right now we just set the status until we have time to implement this                
                perfSigEntry.status = exports.MONSPEC_VIOLATION_STATUS_OK;
                perfSigEntry.actualSourceValue = 0;

                    // TODO: query the value from dynatrace
                /*console.log("Resolving Service Perf Sig Entites for " + perfSigEntry.timeseries);
                perfSigEntry.actualValue = perfSigEntry.upperlimit ? perfSigEntry.upperlimit : perfSigEntry.lowerlimit;
                if(!monspecUtils.checkPerfSigEntryViolation(entitydef, perfSigEntry, true)) {
                    
                }*/
                
                
                // now call the next task
                processMonspec(monspec, fromtime, totime, comparisonname, callback);
                
                break;
            default:
                break;
        }
    });
}
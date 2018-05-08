var AWS = require('aws-sdk');
var dtApiUtils = require('utils/dtapiutils');
var monspecUtils = require('utils/monspec');
var cputils = require('utils/codepipelineutils');
var buildvalidationtable = require('utils/buildvalidationtable');

// this function will most likely be triggered through a scheuled CloudWatch Event but can also be launched manually
// the function will poll the Dynatrace DynamoDB Table BuildValidationRequests and checks whether any new request is available for processing!
exports.handler = (event, context, callback) => {
    
    dtApiUtils.dtApiInit(function(err, data) {
        if(err) {
            console.log("dtApiInit failed: " + err);
            callback(err, "Execution Failed!")
            return;
        }

        buildvalidationtable.getBuildValidationsReadyForProcessing(function(err, entriesToValidate) {
            if(err) {
                console.log("Error when querying for next BuildValidationResults: " + err);
                callback(err, null);
                return;
            }

            if(entriesToValidate == null) {
                // nothing to process
                console.log("No builds to validate right now!");
                callback(null, null);
                return;
            }

            // lets iterate through every open build validation request!
            entriesToValidate.forEach(function(dynamoDBRequestItem) {
                processBuildValidationItem(dynamoDBRequestItem, function(err, monspec, violationCount) {
                    // if we have a processed monspec object we can now #1 store it back to DynamoDB, #2 update any CodePipeline approvals
                    if(err) {callback(err, null);return;}
                    
                    // #1 store in DynamoDB
                    console.log("Updating DynamoDB Entry with new status & filled monspec")
                    buildvalidationtable.updateBuildValidationRequest(dynamoDBRequestItem, monspec, violationCount, function(err, data) {
                        if(err) {
                            console.log("Error updating DynamoDB");
                            callback(err, null); return;
                        }
                    });
                    
                    // #2 check whether there is a codepipeline approval action waiting!
                    if(dynamoDBRequestItem.ApprovalAction && dynamoDBRequestItem.ApprovalAction.S) {
                        cputils.findPipelineApprovalActionInProgress(dynamoDBRequestItem.PipelineName.S, dynamoDBRequestItem.ApprovalAction.S, function(err, data) {
                            if(err) {
                                console.log("Error when finding approval action: " + err);
                                callback(err, null);return;
                            }
    
                            // lets approve the job
                            if(data) {
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
                    }
                });
            });
        });
    });
};

/**
 * is processing one build validation request stored in DynamoDB
 * @param {DynamoDBItem} buildValidationRequest 
 * @param {*} callback 
 */
var processBuildValidationItem = function(buildValidationRequest, callback) {
    // in DynamoDB each column is an object where the first object is the datatype, e.g: S
    console.log("Start processing DynamoDB Item " + buildValidationRequest.PipelineName.S + "/" + buildValidationRequest.Timestamp.N);
    var monspecToProcess = JSON.parse(buildValidationRequest.Monspec.S);
    
    // lets process the monspec definition based on the configured timeframe
    processMonspec(monspecToProcess, buildValidationRequest.Timestamp.N, buildValidationRequest.ReadyToValidateTimestamp.N, buildValidationRequest.ComparisonName.S, function(err, data) {
        if(err) {callback(err, null);console.log("processMospec returned! " + err);return;}
        
        // set the comparision name we used!
        monspecToProcess[monspecUtils.FILLTASK_FIELD_RESOLVED_COMPARISON] = buildValidationRequest.ComparisonName.S;
        
        // check whether we have any violations! - this will impact overall status we write back to DynamoDB
        var violationCount = monspecUtils.getNumberOfViolatedConfigurations(monspecToProcess);
        callback(err, monspecToProcess, violationCount);
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
                                // if we cant find entities that match the tags we only continue with SOURCE and not COMPARE it with anything else. could be that e.g: we dont have data right now in the comparision timeframe 
                                // if the error indicates an API fatal error then we will fail as well!
                                if(err == "500") {
                                    callback(err, null); 
                                    return;
                                }
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
                
                // lets first check if we actually have entities resolved for our "source"
                if(!entities[comparisonConfig.source] || entities[comparisonConfig.source].length == 0) {
                    console.log("No Entities resolved for Source in " + comparisonConfig.source);
                    callback("No Entities resolved for Source in " + comparisonConfig.source, null);
                    return;
                }
                
                var shifttimeframe = comparisonConfig.hasOwnProperty("shiftsourcetimeframe") ? comparisonConfig.shiftsourcetimeframe * 1000 : 0;

                // lets see what perfsignature type we have. we may have timeseries or smartscape check
                // CHECK FOR TIMESERIES!!
                if(perfSigEntry.timeseries) {
                    // we need to resolve both source and compare-source timeseries data - then compare these values
                    console.log("Resolve PerfSig for " + perfSigEntry.timeseries + " on " + comparisonConfig.source);
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
                } else // if(perfSigEntry.timeseries)
                if(perfSigEntry.smartscape) {
                    console.log("Resolve PerfSig for " + perfSigEntry.smartscape + " on " + comparisonConfig.source);
                    
                    // TODO - implement Smartscape queries
                    // right now we simply 

                    perfSigEntry.actualSourceValue = 1;
                    perfSigEntry.actualCompareValue = 1;

                    // check entry violation 
                    monspecUtils.checkPerfSigEntryViolation(entitydef, perfSigEntry, comparisonConfig, true);
                
                    // now call the next task
                    processMonspec(monspec, fromtime, totime, comparisonname, callback);
                } // if(perfSigEntry.smartscape)


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
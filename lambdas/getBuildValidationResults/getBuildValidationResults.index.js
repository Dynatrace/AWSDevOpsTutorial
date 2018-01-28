
var AWS = require('aws-sdk');
var monspecUtils = require('monspec');
var htmlreport = require('buildhtmlreport');

var DYNAMODBTABLE = "BuildValidationRequests";


/**
 * Can be triggered through an API Gateway. Will return a JSON object with all the results of those build validations that fall into the passed filter, e.g: timerange, comparisontype, pipeline, ..
 * The JSON can then be used by a web app and rendered in a chart
 * @param {String} comparisonName
 *  Name of the comparison, e.g: StagingToProduction
 * @param {String} pipelineName
 *  Name of the pipeline
 * @param {Number} timespan
 *  Number in Minutes. If defined we will be returning data from NOW()-timespan until NOW()
 * @param {String} json
 *  true to return just the raw JSON - othewise we return a full HTML Page that renders the data
 * 
 * @return {String}
 *  Returns a JSON Object - here is an example
 *  
 [
    { 'SampleJSonService - service.responsetime(AVG, UPPER)' : 
        [
            {
                name : "Staging",
                data : [['2017-10-04 19:56:00', 100.0], ['2017-10-04 19:58:00', 110.0]]
            },
            {
                name : "Production",
                data : [['2017-10-04 19:56:00', 120.0], ['2017-10-04 19:58:00', 110.0]]
            },
            {
                name : "Threshold",
                data : [['2017-10-04 19:56:00', 110.0], ['2017-10-04 19:58:00', 100.0]]
            },
            {
                name : "Violation",
                data : [['2017-10-04 19:56:00', 0.0], ['2017-10-04 19:58:00', 1.0]]
            }
        ]
    },
    { 'SampleJSonService - service.responsetime(MAX, UPPER)' :
        [  XXXXXX ]
    },
    { 'com.dynatrace.builtin:service.failurerate(AVG, UPPER)' :
        [  XXXXXX ]
    },
    { 'com.dynatrace.builtin:service.requestspermin(COUNT, LOWER)' :
        [  XXXXXX ]
    }    
 ]
 */ 
 
// need to keep track for the earliest timestamp in case we generate a chart in HTML
var smallestTimestamp = 0;
var globalViolationColumn = "Violation";
var globalThresholdColumn = "Threshold"
 
exports.handler = (event, context, callback) => {
    
    // lets check our input parameters
    var pipelineName = null;
    let comparisonName = null;
    var timespan = 10080; // default to 
    var json = false;
    var responseCode = 200;

    // lets get our input parameters    
    if (event.queryStringParameters !== null && event.queryStringParameters !== undefined) {
        if (event.queryStringParameters.pipelineName !== undefined && 
            event.queryStringParameters.pipelineName !== null && 
            event.queryStringParameters.pipelineName !== "") {
            pipelineName = event.queryStringParameters.pipelineName;
        }
    }
    if (event.queryStringParameters !== null && event.queryStringParameters !== undefined) {
        if (event.queryStringParameters.comparisonName !== undefined && 
            event.queryStringParameters.comparisonName !== null && 
            event.queryStringParameters.comparisonName !== "") {
            comparisonName = event.queryStringParameters.comparisonName;
        }
    }
    if (event.queryStringParameters !== null && event.queryStringParameters !== undefined) {
        if (event.queryStringParameters.timespan !== undefined && 
            event.queryStringParameters.timespan !== null && 
            event.queryStringParameters.timespan !== "") {
            timespan = parseInt(event.queryStringParameters.timespan);
        }
    }
    if (event.queryStringParameters !== null && event.queryStringParameters !== undefined) {
        if (event.queryStringParameters.json !== undefined && 
            event.queryStringParameters.json !== null && 
            event.queryStringParameters.json !== "") {
            json = (event.queryStringParameters.json === "true");
        }
    }    
    
    // have to at least have our pipelineName and comparisonName
    if (pipelineName === null || comparisonName === null) {
        if(json) {
            callback("Error with Input Parameter Validation", "PipelineName and ComparisonName are mandatory parameters which were not passed!")
            return;
        } else {
            // lets return a simple HTML page where the user can enter pipelinename and comparisonname
            var response = {
                statusCode: responseCode,
                headers : { "content-type" : "text/html" },
                body: htmlreport.buildHtmlChartReport(null, null, "SampleDevOpsPipeline", "StagingToProduction")
            };
            
            console.log("Response Body: " + response.body);
            callback(null, response);
            return;
        }
    }
    
    // now its time to query our data and return it
    
    getDataFromDynamoDB(pipelineName, comparisonName, timespan, function(err, responseData, xAxisLabels) {
        if(err) {
            callback(err, null);
            return;
        }
        
        if(json) {
            var response = {
                statusCode: responseCode,
                headers : { "content-type" : "application/json" },
                body: JSON.stringify(responseData)
            };
            callback(null, response);    
        } else {
            // lets format it into an HTML Page
            
            var response = {
                statusCode: responseCode,
                headers : { "content-type" : "text/html" },
                body: htmlreport.buildHtmlChartReport(responseData, xAxisLabels, pipelineName, comparisonName)
            };
            
            console.log("Response Body: " + response.body);
            callback(null, response);    
            
        }
    });
};

/**
 * this function will query the results from the DynamoDB Build Validation Table and it will return a JSON Object if successful as documented in this index.js (see top)
 * 
 */ 
 
var REQUEST_STATUS_WAITING = "waiting";
var getDataFromDynamoDB = function(pipelineName, comparisonName, timespan, callback) {
    
    var responseObject = [];
    var xAxisLabebls = [];
    
    // calculate the timestamp. timespan is in minutes so we have to multiple it with 60000 to get to milliseoncs
    var timestamp = Date.now() - timespan * 60000;
    
    // lets query all entries that are not in status waiting, that match pipeline and comparison name and that fall in that timeframe
    var params = {
        ExpressionAttributeValues: {
            ':statuswaiting': {S: REQUEST_STATUS_WAITING},
            ':pipelinename' : {S: pipelineName},
            ':comparisonname' : {S: comparisonName},
            ':readytovalidatetimestamp' : { N: timestamp.toString()}
        },
        ExpressionAttributeNames: {
            "#request_status": "Status"
        },
    
        KeyConditionExpression : "PipelineName = :pipelinename",
        FilterExpression: '#request_status <> :statuswaiting AND ComparisonName = :comparisonname and ReadyToValidateTimestamp >= :readytovalidatetimestamp',
        TableName: DYNAMODBTABLE,
        Select : 'ALL_ATTRIBUTES'
    };
        
    // lets execute the query
    var ddb = new AWS.DynamoDB();
    ddb.query(params, function(err, data) {
        if (err) { 
            console.log("Error", err); 
            callback(err, null);
            return;
        }
        
        if(data.Items.length == 0) {
            console.log("No requests in state waiting found in DynamoDB Table");
            callback(null, responseObject);
            return;
        }
        
        console.log("We found " + data.Items.length + " entries that match our filter");

        // lets iterate through each item, parse the monspec and then extract the values for each metric
        for(var itemIx=0;itemIx<data.Items.length;itemIx++) {
            var monspec = JSON.parse(data.Items[itemIx].Monspec.S);
            
            // create the xAxis Categories 
            xAxisLabebls.push(new Date(parseInt(data.Items[itemIx].ReadyToValidateTimestamp.N)).toGMTString());
            
            // now we iterate through every entity configuration in monspec
            var configurations = monspecUtils.getAllConfigurationNames(monspec);
            for(var monspecConfigIx=0;monspecConfigIx<configurations.length;monspecConfigIx++) {
                var monspecConfig = monspec[configurations[monspecConfigIx]];
                
                // we get the actual comparison config so we know what SOURCE and COMPARE is
                var comparisonConfig = monspecUtils.getComparisonConfiguration(monspecConfig, comparisonName);
                if(comparisonConfig === null) continue;
                
                // now we iterate through the actual perfsignatures
                if(!monspecConfig.perfsignature) continue;
                
                for(var perfsigIx=0;perfsigIx<monspecConfig.perfsignature.length;perfsigIx++) {
                    var perfSigEntry = monspecConfig.perfsignature[perfsigIx];
                    
                    // now we need to find AGGREGATE, VALIDATE, ACTUALSOURCEVALUE, ACTUALCOMPAREVALUE, ACTUALUPPERLIMIT OR ACTUALLOWERLIMIT, STATUS
                    var aggregate = perfSigEntry.aggregate ? perfSigEntry.aggregate.toUpperCase() : "AVG";
                    var validate = perfSigEntry.validate ?  perfSigEntry.validate.toUpperCase() : "UPPER";
                    var actualSource = perfSigEntry.actualSourceValue ? perfSigEntry.actualSourceValue : 0;
                    var actualCompare = perfSigEntry.actualCompareValue ? perfSigEntry.actualCompareValue : 0;
                    var actualLimit = perfSigEntry.actualUpperLimit ? perfSigEntry.actualUpperLimit : (perfSigEntry.actualLowerLimit ? perfSigEntry.actualLowerLimit : 0);
                    var status = perfSigEntry.status ? (perfSigEntry.status === "violation" ? 1 : 0) : 0;
                    var timeseries = perfSigEntry.timeseries;
                    
                    // now lets tidy up the numbers to a max of 2 digits
                    actualSource = parseFloat(actualSource.toFixed(2));
                    actualCompare = parseFloat(actualCompare.toFixed(2));
                    actualLimit = parseFloat(actualLimit.toFixed(2));
                    
                    addResultEntry(responseObject, configurations[monspecConfigIx], aggregate, validate, timeseries, parseInt(data.Items[itemIx].ReadyToValidateTimestamp.N), actualSource, comparisonConfig.source, actualCompare, comparisonConfig.compare, actualLimit, globalThresholdColumn, status, globalViolationColumn);
                }
            }
            
        }
        

        callback(null, responseObject, xAxisLabebls);
    });
}

/**
 * will add a new entry to the resultObject - the structureof this object is described in this file in the top
 */ 
var metricPrefix = "com.dynatrace.builtin:";
var metricPrefixLen = metricPrefix.length;
var addResultEntry = function(resultObject, entityConfigName, aggregate, validate, metricName, timestamp, sourceValue, sourceName, compareValue, compareName, boundaryValue, boundaryName, violationValue, violationName) {
    // lets build the entry name
    if(metricName.startsWith(metricPrefix)) metricName = metricName.substr(metricPrefixLen);
    var entryMetricName = entityConfigName + " - " + metricName + "(" + aggregate + "," + validate + ")";
    
    var resultObjectEntry = getResultObjectEntryForEntitiyMetric(resultObject, entryMetricName);
    var resultObjectEntryForMetricProperty = resultObjectEntry[entryMetricName];
    addResultToEntryObject(resultObjectEntryForMetricProperty, "S: " + sourceName, timestamp, sourceValue);
    addResultToEntryObject(resultObjectEntryForMetricProperty, "C: " + compareName, timestamp, compareValue);
    addResultToEntryObject(resultObjectEntryForMetricProperty, boundaryName, timestamp, boundaryValue);
    addResultToEntryObject(resultObjectEntryForMetricProperty, violationName, timestamp, violationValue);
}

/**
 * iterates through the result object array and finds a matching entry. will create one in case none is there yet
 * 
  { 'SampleJSonService - service.responsetime(AVG, UPPER)' :
        [ ]
  }
 */ 
var getResultObjectEntryForEntitiyMetric = function(resultObject, entityMetricName) {
    // check if we already have an entry for this resultMetrics and Entity
    var resultObjectEntry = null;
    for(var entryIx=0;entryIx<resultObject.length;entryIx++) {
        resultObjectEntry = resultObject[entryIx];
        if(resultObjectEntry.hasOwnProperty(entityMetricName)) return resultObjectEntry;
    }
    
    resultObjectEntry = {};
    resultObjectEntry[entityMetricName] = [];
    resultObject.push(resultObjectEntry);
    
    return resultObjectEntry;
}

/**
 * adding the following entry to the resultObjectEntry. first iterates through the arrays and tries to find an entry by name. if not there we create it - otherwise we just add a new data array element
 * 
            {
                name : "Staging",
                data : [['2017-10-04 19:56:00', 100.0], ['2017-10-04 19:58:00', 110.0]]
            },

 */ 
var addResultToEntryObject = function(resultObjectEntry, name, timestamp, value) {
    var resultValueEntry = null;
    for(var entryIx=0;entryIx<resultObjectEntry.length;entryIx++) {
        resultValueEntry = resultObjectEntry[entryIx];
        if(resultValueEntry.name === name) break; else resultValueEntry = null;
    }
    
    var isViolationColumn = (name === globalViolationColumn);
    var isThresholdColumn = (name === globalThresholdColumn);
    if(resultValueEntry == null) {
        resultValueEntry = {
            name : name,
            data : [],
            yAxis : isViolationColumn ? 1 : 0,
            type: isViolationColumn ? 'column' : 'spline',
        }
        
        if (isViolationColumn) {
            resultValueEntry.color = '#FF0000';
        }
        
        if (isThresholdColumn) {
            resultValueEntry.dashStyle = 'shortdot';
            resultValueEntry.color = '#00FF00';
        }
        
        resultObjectEntry.push(resultValueEntry);
    }
    
    // lets convert the timestamp to a string representation
    if(smallestTimestamp == 0 || smallestTimestamp > timestamp)
        smallestTimestamp = timestamp;
        
    // resultValueEntry.data.push([new Date(timestamp).toString(), value]);
    resultValueEntry.data.push([new Date(timestamp), value]);
    
    return resultObjectEntry;
    
}
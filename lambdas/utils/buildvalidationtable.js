var AWS = require('aws-sdk');
var monspecUtils = require('./monspec');

var DYNAMODBTABLE = "BuildValidationRequests";
var REQUEST_STATUS_WAITING = "waiting";

/**
 * Creates a new Entry in the BuildValidationTable
 * @param {object} request
 *  this object has to contain all necessary information such as pipelineName, timestamp, status, source, comparisonname, validationtimeframe, monspec, pipelineStage, pipelinAction
 *  Optional values in request are: approvalAction, jobid, resulthook, pipelinetoken, statusmsg, outputArtifact, artifactCredentials
 */
exports.createBuildValidationEntry = function(request, callback) {
    var db = new AWS.DynamoDB();
    
    console.log("uploadToDynamo: " + JSON.stringify(request));
    
    var params = {
        Item: {
            "PipelineName" : {          S: request.pipelineName },
            "Timestamp": {              N: request.timestamp.toString() },
            "TimestampAsString":{       S: new Date(request.timestamp).toUTCString()},
            "Status": {                 S: request.status }, 
            "Source": {                 S: request.source },
            "ComparisonName": {         S: request.comparisonname },
            "Validationtimeframe": {    N: request.validationtimeframe },
            "ReadyToValidateTimestamp":{N: (request.timestamp + request.validationtimeframe * 60000).toString() },
            "Monspec": {                S: request.monspec },
            "PipelineStage" : {         S: request.pipelineStage },
            "PipelineAction" : {        S: request.pipelineAction },
        }, 
        ReturnConsumedCapacity: "TOTAL", 
        TableName: DYNAMODBTABLE
    };

    // check optional values
    if(request.approvalAction)
        params.Item.ApprovalAction = { S : request.approvalAction };
    if(request.jobId)
        params.Item.JobId = {  S: request.jobId };
    if(request.resulthook)
        params.Item.Resulthook = {  S: request.resulthook };
    if(request.pipelineToken)
        params.Item.PipelineToken = {  S: request.pipelineToken };
    if(request.statusmsg)
        params.Item.Statusmsg = {  S: request.statusmsg };
    if(request.outputArtifact)
        params.Item.OutputArtifacts =  {     S: JSON.stringify(request.outputArtifact) };
    if(request.artifactCredentials)
        params.Item.ArtifactCredentials = {  S: JSON.stringify(request.artifactCredentials) };

    console.log("uploadToDynamo(putItem): " + JSON.stringify(params));
    db.putItem(params, function(err, data) {
        if(err) console.log("uploadToDynamo: " + err);
        callback(err, data);
    });
}

/**
 * Helper function that gets called recursively in case there are too many scan results! 
 * Will be called from getBuildValidationsReadyForProcessing!
 */ 
var scanForNextBuildValidationReadyForProcessing = function(LastEvaluatedKey, callback) {
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
    if(LastEvaluatedKey) {
        params.ExclusiveStartKey = LastEvaluatedKey;
    }

    // lets execute the query!
    ddb.scan(params, function(err, data) {
        if (err) { 
            console.log("Error", err); 
            callback(err, null);
            return;
        }
        
        // the scan will only scan to a maximum limit - if no elements are found in the scan but there is more data to scan we have to check on LastEvaluatedKey. If that value is not empty we have run another scan
        if(data.Items.length == 0 && data.LastEvaluatedKey) {
            scanForNextBuildValidationReadyForProcessing(data.LastEvaluatedKey, callback);
            return;
        }

        
        if(data.Items.length == 0) {
            console.log("No requests in state waiting found in DynamoDB Table");
            callback(null, null);
            return;
        }

        // return back the list of entries!
        callback(null, data.Items);
    });
    
}

/**
 * Returns the build validation entries that are ready for processing
 * @param {Function} callback (err, dataItems)
 *  dataItems is the list of DynamoDB Items!
 */
exports.getBuildValidationsReadyForProcessing = function(callback) {
    scanForNextBuildValidationReadyForProcessing(null, callback);
}
                    
/**
 * Updates the DynamoDbRequestItem with the new monspec
 * @param {Object} dynamoDBRequestItem 
 * @param {Object} monspecToProcess 
 * @param {Number} violationCount 
 * @param {*} callback 
 */
exports.updateBuildValidationRequest = function(dynamoDBRequestItem, monspecToProcess, violationCount, callback) {
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
 * Queries the DynamoDB Table and returns an array of Monspecs of BuildValidations for that Pipeline, comparisonName, Timeframe and those that are not in status waiting
 * @param {String} pipelineName 
 * @param {String} comparisonName 
 * @param {Number} timespan 
 * @param {Function} callback 
 */
exports.queryMonspecsFromDatabase = function(pipelineName, comparisonName, timespan, callback) {
    
    var resultMonspecs = [];
    var resultTimestamps = [];
    
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
            callback(err, null, null);
            return;
        }
        
        if(data.Items.length == 0) {
            console.log("No requests in state waiting found in Table: " + DYNAMODBTABLE);
            callback(null, resultMonspecs, resultTimestamps);
            return;
        }
        
        console.log("We found " + data.Items.length + " entries that match our filter");

        // lets iterate through each item, parse the monspec and then extract the values for each metric
        for(var itemIx=0;itemIx<data.Items.length;itemIx++) {
            var monspec = JSON.parse(data.Items[itemIx].Monspec.S);

            resultMonspecs.push(monspec);
            resultTimestamps.push(parseInt(data.Items[itemIx].ReadyToValidateTimestamp.N));
            
        }
        
        callback(null, resultMonspecs, resultTimestamps);
    });
}

/**
 * will check DynamoDB for a result of the same Pipeline and the referenced Action Name that is either ok or violation and has not yet been uploaded! 
 * @param {*} job 
 * @param {*} callback 
 */
exports.findBuildValidationEntryForJobNotUploaded = function(job, callback) {
    var dtRegisterBuildActionReference = job.data.actionConfiguration.configuration.UserParameters;   
    cputils.getJobDetails(job.id, false, function(err, data) {
        if(err) {callback(err, null); return;}
        
        var ddb = new AWS.DynamoDB();

        // we are looking for the result in the DynamoDB table for the referenced action that has not yet been uploaded
        var params = {
            ExpressionAttributeValues: {
                ':statusok': {S: 'ok'},
                ':statusviolation': {S: 'violation'},
                ':pipelinename' : {S: data.pipelineName},
                ':pipelineaction' : {S: dtRegisterBuildActionReference}
            },
            ExpressionAttributeNames: {
                "#request_status": "Status"
            },
        
            FilterExpression: '#request_status IN (:statusok, :statusviolation) AND PipelineName = :pipelinename AND PipelineAction = :pipelineaction and attribute_not_exists(ResultsUploaded)',
            TableName: DYNAMODBTABLE,
            Select : 'ALL_ATTRIBUTES'
        };
        
        // lets execute the query
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
            
            // there should only be max 1 result that matches - if there are more we will take the last entry
            if(data.Items.length == 0) {
                // nothing found - no results - thats an error situation or a misconfiguration
                callback("Couldnt find any results for requested build action", null);
                return;
            }
            
            
            var item = data.Items[data.Items.length - 1];
            console.log("Found a result entry: " + JSON.stringify(item));
            callback(null, item);
        });
    });
}

/**
 * will add the "uploaded" column to the referenced item
 * @param {*} dynamoDbItem 
 * @param {*} callback 
 */
exports.markBuildValidationEntryAsUpdated = function(dynamoDbItem, callback) {
    var ddb = new AWS.DynamoDB();
    
    var params = {
        Key:{
            "RequestID": { N: dynamoDbItem.RequestID.N } 
        },
        ExpressionAttributeValues: {
            ':resultsUploaded' : {S: "1"}
        },
        UpdateExpression: "set ResultsUploaded=:resultsUploaded",
        TableName: DYNAMODBTABLE,
        ReturnValues : 'UPDATED_NEW'
    };
    
    // now we update the item in DynamoDB
    ddb.updateItem(params, function(err, data) {
        if (err) { 
            console.log("Error", err); 
            callback(err, null);
            return;
        }

        console.log("Successfully uploaded RequestID " + dynamoDbItem.RequestID + " with column resultsUploaded")        
        callback(null, "OK");
    });
}
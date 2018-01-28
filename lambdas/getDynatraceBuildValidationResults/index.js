var AWS = require('aws-sdk');
var cputils = require('codepipelineutils');

var DYNAMODBTABLE = "BuildValidationRequests";
var REQUEST_STATUS_WAITING = "waiting";

// Can be called from a CodePipeline Invoke Action. If there is a result monspec for that buildpipeline stored in the DynamoDB table we upload it as a build artifact!
// the function expects the name of the dynatrace registerBuildValidationAction in the comment (=UserData)
exports.handler = (event, context, callback) => {
    
    var job = null;
    
    try {
        
        if (event["CodePipeline.job"]) {
            console.log("Called from CodePipeline");
            console.log(JSON.stringify(event));
            
            job = event["CodePipeline.job"];
    
            // lets check whether we have a result in DynamoDB for this action
            findDynamoDBResult(job, function(err, dynamoDBItem) {
               if(err) {callback(err, null); return;}
    
                // #1 upload the monspec to the outputartifactd if one has been defined
                if(job.data.outputArtifacts && (job.data.outputArtifacts.length > 0) && job.data.artifactCredentials) {
                    var outputArtifact = job.data.outputArtifacts[0];
                    var artifactCredentials = job.data.artifactCredentials;
                    cputils.uploadFile(outputArtifact, artifactCredentials, "monspec.json", dynamoDBItem.Monspec.S, function(err, data) {
                        if(err) {
                            console.log("Error uploading monspec to output artifact!" + err);
                            cputils.putJobFailure("Error: " + err, job.id, context);
                            callback(err, null);
                            return;
                        } 
                    
                        // now we have to update the table entry and add the field "uploaded"
                        markDynamoDBEntryAsUpdated(dynamoDBItem, function(err, data) {
                            if(err) {
                                console.log("Error updating DynamoDB entry" + err);
                                cputils.putJobFailure("Error: " + err, job.id, context);
                                callback(err, null);
                                return;
                            }

                            console.log("Successfully uploaded result to S3 Output Artifact");    
                            cputils.putJobSuccess("Upload successful", job.id, context);
                            callback(null, "Upload successful");
                        });
                    });
                }    
            });
        }
    } catch(error) {
        if(job && job.id)
            cputils.putJobFailure("Error: " + error, job.id, context);
    }
};

// will add the "uploaded" column to the referenced item
var markDynamoDBEntryAsUpdated = function(dynamoDbItem, callback) {
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

// will check DynamoDB for a result of the same Pipeline and the referenced Action Name that is either ok or violation and has not yet been uploaded!
var findDynamoDBResult = function(job, callback) {
    var dtRegisterBuildActionReference = job.data.actionConfiguration.configuration.UserParameters;   
    cputils.getJobDetails(job.id, function(err, data) {
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
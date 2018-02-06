var AWS = require('aws-sdk');
var cputils = require('utils/codepipelineutils');
var buildvalidationtable = require('utils/buildvalidationtable');

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
            buildvalidationtable.findBuildValidationEntryForJobNotUploaded(job, function(err, dynamoDBItem) {
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
                        buildvalidationtable.markBuildValidationEntryAsUpdated(dynamoDBItem, function(err, data) {
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
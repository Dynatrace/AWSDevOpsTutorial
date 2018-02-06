var AWS = require('aws-sdk');
var cputils = require('utils/codepipelineutils');
var buildvalidationtable = require('utils/buildvalidationtable');

var DEFAULT_VALIDATIONTIMEFRAME = 5; // 5 Minutes is default timeframe if not specified!

// can be called from CodePipeline or any other point to register a build validation request
// WHEN called from CodePipeline
// -- UserParameters can either be a URI to monspec or can have the following format: [ComparisonName],[ValidationTimeFrameInMinutes],[ApprovalActionName]
// -- InputArtifact: can point to an S3 location with a monspec.json file
// this function will put all relevant information into DynamoDB which is periodically checked from the pollDynatraceBuildValidation lambda
// this function puts the following information in a DynamoDB Table
// - source: CodePipeline, Other
// - timestamp: Timestamp when this request was made
// - validationtimeframe: in minutes, e.g: 5 - this means 5 minutes after Timestamp we start the validation process
// - monspec: the monspec json object that contains all baseline information
// - resulthook: (optional) a webhook we call with the actual result
// - pipelinetoken: (optional) if codepipeline initiates the validation we store the token to confirm the pipeline step
// - status: waiting (for validation timeframe), ok (if validation succeeded) or error (if validation failed)
// - statusmsg: in case of error this can contain more information
exports.handler = (event, context, callback) => {
    
    var job = null;
    
    try {
    
        var request = {
            source : "",
            timestamp : Date.now(),
            status: "waiting",
            validationtimeframe : 0,
            monspec : " ",
            pipelineName : " ",
            pipelineStage : " ",
            pipelineAction : " ",
        }
        
        if (event["CodePipeline.job"]) {
            console.log("Called from CodePipeline");
            console.log(JSON.stringify(event));
            
            request.source = "CodePipeline";
            job = event["CodePipeline.job"];
            request.pipelineToken = job.id;
            
            var monspecuri = null;
            var artifact = null;
            var artifactCredentials = null;
            if(job.data.actionConfiguration.configuration.UserParameters.startsWith("http")) {
                monspecuri = job.data.actionConfiguration.configuration.UserParameters;   
            } else {
                // CodePipeline can have a UserParameters definition like this: [ComparisonName],[ValidationTimeFrameInMinutes],[ApprovalActionName]
                // Here is an example for UserParameters: StagingToProduction,5,ApprovalStaging
                var userData = job.data.actionConfiguration.configuration.UserParameters;
                var userDataParams = userData.split(",");
                request.comparisonname = userDataParams[0]
                request.validationtimeframe = userDataParams.length > 0 ? userDataParams[1] : DEFAULT_VALIDATIONTIMEFRAME;
                if(userDataParams.length > 1) {
                    request.approvalAction = userDataParams[2];
                }
                
                // in that case we have to have the monspec.json from the input artifacts
                if(!job.data.inputArtifacts || !job.data.inputArtifacts[0]) {
                    cputils.putJobFailure("No Input Artifact Defined", job.id, context);
                    return;
                }
                
                artifact = job.data.inputArtifacts[0];
                artifactCredentials = job.data.artifactCredentials;
            }
            
            // lets download the monspec.json either from the artifact or the URI
            cputils.downloadFile(artifact, artifactCredentials, monspecuri, function(err, content) {
                if(err) {
                    cputils.putJobFailure(err, job.id, context);
                    return;
                }
                
                // last thing we want is more details about the Pipeline
                cputils.getJobDetails(job.id, false, function(err, jobDetails) {
                    if(err) {
                        cputils.putJobFailure(err, job.jobid, context);
                        return;
                    }
                    
                    request.pipelineName = jobDetails.pipelineName;
                    request.pipelineStage = jobDetails.stage;
                    request.pipelineAction = jobDetails.action;
                    request.jobId = job.id;

                    // if we have output artifacts also push them to DynamoDB incl Credentials
                    if(jobDetails.outputArtifact) {
                        request.outputArtifact = jobDetails.outputArtifact;
                        request.artifactCredentials = jobDetails.artifactCredentials;
                    }
                   
                    // and now we upload it to DynamoDB
                    request.monspec = content;
                    buildvalidationtable.createBuildValidationEntry(request, function(err, data) {
                        if(err) cputils.putJobFailure(err, job.id, context);
                        else cputils.putJobSuccess(err, job.id, context);
                        return;
                    });
    
                });
            });
            
            return;
        } // if (event["CodePipeline.job"])
        else {
            // TODO: Implement when getting called from a different source than CodePipeline!
        }
    } 
    catch(error) {
        if(job && job.id)
            cputils.putJobFailure("Error: " + error, job.id, context);
    }
};
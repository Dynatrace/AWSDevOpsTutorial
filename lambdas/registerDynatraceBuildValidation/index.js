var AWS = require('aws-sdk');
var cputils = require('codepipelineutils');


var DYNAMODBTABLE = "BuildValidationRequests";

// can be called from CodePipeline or any other point to register a build validation request
// WHEN called from CodePipeline
// -- UserParameters can either be a URI to monspec or the validationtimeframe
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
                // codepipeline can pass comparisondefname and validationtimeframe as part of UserParameters, e.g: StagingToProduction,5
                var userData = job.data.actionConfiguration.configuration.UserParameters;
                var userDataParams = userData.split(",");
                request.comparisonname = userDataParams[0]
                request.validationtimeframe = userDataParams[1];
                
                // in that case we have to have the monspec.json from the input artifacts
                if(!job.data.inputArtifacts || !job.data.inputArtifacts[0]) {
                    cputils.putJobFailure("No Input Artifact Defined", job.id, context);
                    return;
                }
                
                artifact = job.data.inputArtifacts[0];
                artifactCredentials = job.data.artifactCredentials;
            }
            
            console.log("About to download file!");
            
            // lets download the monspec.json either from the artifact or the URI
            cputils.downloadFile(artifact, artifactCredentials, monspecuri, function(err, content) {
                if(err) {
                    cputils.putJobFailure(err, job.id, context);
                    return;
                }
                
                // last thing we want is more details about the Pipeline
                cputils.getJobDetails(job.id, function(err, jobDetails) {
                    if(err) {
                        cputils.putJobFailure(err, job.jobid, context);
                        return;
                    }
                    
                    console.log("JobDetails: " + JSON.stringify(jobDetails));
                   
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
                    uploadToDynamo(request, function(err, data) {
                        console.log("returned from uploadToDynamo");
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

/**
 * @param {object} request
 */
var uploadToDynamo = function(request, callback) {
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
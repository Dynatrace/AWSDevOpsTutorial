var AWS = require('aws-sdk');
var https = require('https');

var codepipeline = new AWS.CodePipeline();

exports.putApprovalResult = function(actionDetails, result, context, callback) {
    var params = { 
        actionName: actionDetails.actionName,
        pipelineName : actionDetails.pipelineName,
        stageName : actionDetails.stageName,
        token : actionDetails.token,
        result : result
    };
    
    console.log("input actiondetails: " + JSON.stringify(actionDetails));
    console.log("approval result: " + JSON.stringify(result));
    
    codepipeline.putApprovalResult (params, function(err, data) {
        console.log("putApprovalResult " + err + ", " + JSON.stringify(data));
        if(err) {
            if(context && context.fail) context.fail(err);      
            if(callback) callback(err, data);
        } else {
            if(context && context.succeed) context.succeed(result.message);      
            if(callback) callback(err, data);
        }
    });
}

// Notify AWS CodePipeline of a successful job
exports.putJobSuccess = function(message, cpjobid, context) {
    var params = { jobId: cpjobid };
    codepipeline.putJobSuccessResult(params, function(err, data) {
        if(err) {
            context.fail(err);      
        } else {
            context.succeed(message);      
        }
    });
};
    
// Notify AWS CodePipeline of a failed job
exports.putJobFailure = function(message, cpjobid, context) {
    var params = {
        jobId: cpjobid,
        failureDetails: {
            message: JSON.stringify(message),
            type: 'JobFailed',
            externalExecutionId: context.invokeid
        }
    };
    codepipeline.putJobFailureResult(params, function(err, data) {
        if(err) {
            context.fail(err);      
        } else {
            context.succeed(message);      
        }
    });
};

// retrieve more CodePipeline Details from a Job Id
exports.getJobDetails = function(cpjobid, callback) {
    var params = { jobId: cpjobid };
    codepipeline.getJobDetails(params, function(err, data) {
        if(err) {
            callback(err, null);      
        } else {
            console.log("Data from getJobDetails!");
            console.log(data);
            console.log(JSON.stringify(data));
            
            var pipelineContext = data["jobDetails"]["data"]["pipelineContext"];
            
            var jobDetails = {
                pipelineName : pipelineContext["pipelineName"],
                stage: pipelineContext["stage"]["name"],
                action: pipelineContext["action"]["name"]
            }
            
            callback(null, jobDetails);      
        }
    });
}

// finds the approval action in the pipeline where the comment (=UserData) contains the customdatamatch
// returns:
/*
  { stage : "stagename", action : "actionname", pipeline : "pipelinename", token : "approvaltoken, outputartifact : "artifactname", customdata : "full custom data on found action" }"
*/
exports.findPipelineApprovalAction = function(pipelinename, registerBuildValidationActionName, customdatamatch, callback) {

    var foundApprovalAction = null;

    console.log("findPipelineApprovalAction for " + pipelinename + ", " + registerBuildValidationActionName + ", " + customdatamatch);
    
    // lets check the pipeline and find an approval stage that has the commentmatch
    codepipeline.getPipeline({name:pipelinename}, function(err, data) {
        if(err) {callback(err, null); return;}

        for(var stageIx = 0;stageIx < data.pipeline.stages.length; stageIx++) {
            var stage = data.pipeline.stages[stageIx];
            for(var actionIx = 0;actionIx < stage.actions.length; actionIx++) {
                var action = stage.actions[actionIx];
                if(action.actionTypeId.category == "Approval") {
                    
                    // now lets check whether they configuration has a match with our comment
                    if(action.configuration.hasOwnProperty("CustomData") && action.configuration.CustomData.includes(customdatamatch)) {
                        // found our match!
                        foundApprovalAction = {stageName : stage.name, actionName : action.name, pipelineName : pipelinename, customdata : action.configuration.CustomData};
                    }
                }
            }            
        }        
        
        if(foundApprovalAction == null) {
            console.log("No action found that matches comment");
            callback(null, "No Pipeline Action Found that matches the name and comment!");
            return;
        } else {
            console.log("We found an approval action that matches! " + JSON.stringify(foundApprovalAction));
        }
    
        // now lets check if the approval action is InProgress
        codepipeline.getPipelineState({name:pipelinename}, function(err, data) {
            if(err) {
                console.log("getPipelineState returned error: " + err);
                callback(err, null); 
                return;
            }
            
            console.log(JSON.stringify(data));
            
            // lets find any approval action that is in state waiting
            for(var stageIx = 0;stageIx < data.stageStates.length; stageIx++) {
                var stage = data.stageStates[stageIx];
                if(stage.stageName === foundApprovalAction.stageName) {
                    console.log("found stage name ");
                    for(var actionStageIx = 0;actionStageIx < stage.actionStates.length; actionStageIx++) {
                        var actionStage = stage.actionStates[actionStageIx];
                        
                        if( (actionStage.actionName === foundApprovalAction.actionName)) {
                            
                            console.log("found matching actionname" + JSON.stringify(actionStage));
                            if(actionStage.hasOwnProperty("latestExecution") && 
                               (actionStage.latestExecution.status === "InProgress")) {
                                // we found our stage that matches the comment and that is currently in progress

                                if(actionStage.latestExecution.hasOwnProperty("token"))
                                    foundApprovalAction.token = actionStage.latestExecution.token;
                                    
                                console.log("found match - " + JSON.stringify(foundApprovalAction));
                                callback(null, foundApprovalAction);
                                return;
                            }
                        }
                    }
                }
            }
            
            // seems we havent found a match
            callback(null, null);
        });
        
    });
}

// either downloads the inputartifact or the uri
// callback(err, downloadcontent)
exports.downloadFile = function(inputArtifact, artifactCredentials, uri, callback) {
    
    console.log(inputArtifact);
    console.log(JSON.stringify(inputArtifact));
    
    if(inputArtifact && artifactCredentials) {
        var s3 = new AWS.S3({accessKeyId : artifactCredentials.accessKeyId, secretAccessKey : artifactCredentials.secretAccessKey, sessionToken : artifactCredentials.sessionToken});
        var params = {
            Bucket: inputArtifact.location.s3Location.bucketName,
            Key: inputArtifact.location.s3Location.objectKey
        };
        
        s3.getObject(params, function(err, data) {
            if(err) {console.log(err);callback(err, null);}
            return callback(null, data.Body.toString());
        });
        
    } else if(uri) {
        var get_req = https.request(uri, function(res) {
            var responseBody = "";
            res.setEncoding('utf8');
            res.on('data', function (chunk) {
                responseBody += chunk;
            });
            res.on('end', function() {
                console.log("Download file: " + responseBody);
                callback(null, responseBody);
            });
        });
        
        get_req.end();
    }
}

// TODO: implement an upload file feature where we can upload e.g: filled monspec file
exports.uploadFile = function(outputArtifact, artifactCredentials, filename, content, callback) {
    console.log("uploadeding " + filename + " to " + JSON.stringify(outputArtifact) + " with " + JSON.stringify(artifactCredentials));
    
    if(outputArtifact && artifactCredentials) {
        var s3 = new AWS.S3({accessKeyId : artifactCredentials.accessKeyId, secretAccessKey : artifactCredentials.secretAccessKey, sessionToken : artifactCredentials.sessionToken, signatureVersion : 'v4'});
        var params = {
            Bucket: outputArtifact.location.s3Location.bucketName,
            Key: outputArtifact.location.s3Location.objectKey,
            Body : content,
            ServerSideEncryption : "aws:kms"
        };
        
        s3.upload(params, function(err, data) {
            if(err) {console.log(err);callback(err, null);return;}
            console.log("upload returned: " + data);
            return callback(null, data);
        });
       
    } else {
        callback("Artifact not properly defined")
    }
}
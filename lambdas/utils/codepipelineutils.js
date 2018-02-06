var AWS = require('aws-sdk');
var https = require('https');

var codepipeline = new AWS.CodePipeline();
var codedeploy = new AWS.CodeDeploy();

/**
 * Reports Error back to the job and context object
 * @param {String} message 
 * @param {String} codePipelineJobId 
 * @param {Object} context 
 */
exports.reportError = function(message, codePipelineJobId, context) {
    if(codePipelineJobId) exports.putJobFailure(message, codePipelineJobId, context);
    else if (context && context.fail) context.fail(message);
    console.log("Error: " + message);
}

/**
 * reports Success back to the Job and the context object
 * @param {String} message 
 * @param {String} codePipelineJobId 
 * @param {Object} context 
 */
exports.reportSuccess = function(message, codePipelineJobId, context) {
    if(codePipelineJobId) exports.putJobSuccess(message, codePipelineJobId, context);
    else if (context && context.succeed) context.succeed(message);
    console.log("Success: " + message);
}

/**
 * Approves the action referenced in actionDetails via putApprovalResult
 * @param {Object} actionDetails 
 *  Object with properties actionName, pipelineName, stageName, token
 * @param {String} result 
 *  the actual result for the approval
 * @param {Object} context 
 *  if passed will call fail or succeed depending on outcome of putApprovalResult
 * @param {*} callback 
 */
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

/**
 * Notify AWS CodePipeline of a successful job via putJobSuccessResult
 * @param {String} message 
 * @param {String} cpjobid 
 * @param {Object} context 
 *  if passed will call fail or succeed depending on outcome of putJobSuccessResult
 */
exports.putJobSuccess = function(message, cpjobid, context) {
    console.log("putJobSuccess: " + cpjobid);    
    var params = { jobId: cpjobid };
    codepipeline.putJobSuccessResult(params, function(err, data) {
        if(err) {
            if(context && context.fail) context.fail(err);       
        } else {
            if(context && context.succeed) context.succeed(message);     
        }
    });
};
    
/**
 * Notify AWS CodePipeline of a failed job via putJobFailureResult
 * @param {String} message 
 * @param {String} cpjobid 
 * @param {Object} context 
 *  if passed will call fail or succeed depending on outcome of putJobFailureResult
 */
exports.putJobFailure = function(message, cpjobid, context) {
    console.log("putJobFailure: " + JSON.stringify(message));    
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
            if(context && context.fail) context.fail(err);
        } else {
            if(context && context.succeed) context.succeed(message);      
        }
    });
};

/**
 * returns informaiton about the deployment group, e.g: latest successful deployment
 * @param {Function} callback (err, deploymentGroup)
 *  where deploymentGroup is the information returned by codedeploy.getDeploymentGroup
 */ 
exports.getCodeDeployDeploymentGroupInfo = function(applicationName, deploymentGroupName, callback) {
    codedeploy.getDeploymentGroup({applicationName : applicationName, deploymentGroupName : deploymentGroupName}, function(err, deploymentGroupData) {
        if(err) {callback(err, null); console.log("getDeploymentGroup failed: " + err); return;}
        
        callback(null, deploymentGroupData);
    });
}

/**
 * Returns information about the CodeDeploy Action IF found in the stage of the pipeline
 * @param {Function} callback(err, codedeploy)
 *  where codedeploy is an object with properties application, deploymentGroup, deploymentId
 */ 
exports.getCodeDeployDetails = function(pipelineName, stageName, callback) {
    console.log("getCodeDeployDetails: " + pipelineName + ", " + stageName);
    
    // lets find the first CodeDeploy Action in the same Pipeline Stage
    codepipeline.getPipeline({name: pipelineName}, function(err, pipelineData) {
        if(err) {callback(err, null); console.log("getPipeline failed: " + err); return;} 
        
        // console.log(JSON.stringify(pipelineData));
        for(var stageIx=0;stageIx<pipelineData.pipeline.stages.length;stageIx++) {
            var stage = pipelineData.pipeline.stages[stageIx];
                        
            if(stage.name == stageName) {
                for(var actionIx=0;actionIx<stage.actions.length;actionIx++) {
                    var action = stage.actions[actionIx];
                    if((action.actionTypeId.category === "Deploy") && (action.actionTypeId.owner === "AWS") && (action.actionTypeId.provider === "CodeDeploy")) {
                        var codedeploy = {};
                        codedeploy.application = action.configuration.ApplicationName;
                        codedeploy.deploymentGroup = action.configuration.DeploymentGroupName;
    
                        exports.getCodeDeployDeploymentGroupInfo(codedeploy.application, codedeploy.deploymentGroup, function(err, deploymentGroupData) {
                            if(err) {callback(err, null); console.log("getCodeDeployDeploymentGroupInfo failed: " + err); return;} 
                            
                            // now lets get the latest revision
                            codedeploy.deploymentId = deploymentGroupData.deploymentGroupInfo.lastSuccessfulDeployment.deploymentId;
                                                        
                            callback(null, codedeploy);
                            return;
                        });
                        
                        return;
                    }
                }
            }
        }
        
        callback(null, null);
        return;
    });
    
}

/**
 * retrieve more CodePipeline Details from a Job Id
 * @param {String} cpjobid
 *  returns information about this job
 * @param {Boolean} addCodeDeployDetails
 *  if True then we are looking for the first CodeDeploy confiugration in the same Pipeline Stage. If one exists we also return informaton about the last CodeDeploy Execution
 * @param {Function) callback (err, jobDetails)
 *  where jobDetails is a jobDetails object with pipelineName, stage, action and optionally codedeploy.application, codedeploy.revision, codedeploy.
 */
exports.getJobDetails = function(cpjobid, addCodeDeployDetails, callback) {
    var params = { jobId: cpjobid };
    codepipeline.getJobDetails(params, function(err, data) {
        if(err) {
            callback(err, null);      
        } else {
            console.log("Data from getJobDetails!");
            console.log(JSON.stringify(data));
            
            var pipelineData = data["jobDetails"]["data"];
            var pipelineContext = pipelineData["pipelineContext"];
            
            var jobDetails = {
                pipelineName : pipelineContext["pipelineName"],
                stage: pipelineContext["stage"]["name"],
                action: pipelineContext["action"]["name"]
            }

            if(pipelineData["outputArtifacts"] && pipelineData["outputArtifacts"].length > 0) {
                jobDetails.outputArtifact = pipelineData["outputArtifacts"][0];
                jobDetails.artifactCredentials = pipelineData["artifactCredentials"];
            }
            
            if(addCodeDeployDetails) {
                // lets find the first CodeDeploy Action in the same Pipeline Stage
                exports.getCodeDeployDetails(jobDetails.pipelineName, jobDetails.stage, function(err, codeDeployData) {
                    if(err) {callback(err, null); console.log("getCodeDeployDetails failed: " + err); return;} 
                    
                    jobDetails.codedeploy = codeDeployData;
                    callback(null, jobDetails);
                });
            }
            else { 
                callback(null, jobDetails); 
            }   
        }
    });
}

/**
 * This function will validate whether the ApprovalAction in the passed Pipeline is currently waiting for approval. If so - it returns all information necessary to approve/reject that action 
 * @param {String} pipelinename
 *  Nane of the AWS CodePipeline
 * @Param {String} approvalActionName
 *  The name of the Approval Action we are looking for
 * @Param {object} callback
 *  { stage : "stagename", action : "actionname", pipeline : "pipelinename", token : "approvaltoken, outputartifact : "artifactname", customdata : "full custom data on found action" }"
 */
exports.findPipelineApprovalActionInProgress = function(pipelinename, approvalActionName, callback) {

    var foundApprovalAction = null;

    console.log("findPipelineApprovalActionInProgress for " + pipelinename + ", " + approvalActionName);
    
    // lets check the pipeline and find an approval stage that has the commentmatch
    codepipeline.getPipeline({name:pipelinename}, function(err, data) {
        if(err) {callback(err, null); return;}

        for(var stageIx = 0;stageIx < data.pipeline.stages.length; stageIx++) {
            var stage = data.pipeline.stages[stageIx];
            for(var actionIx = 0;actionIx < stage.actions.length; actionIx++) {
                var action = stage.actions[actionIx];
                if((action.actionTypeId.category === "Approval") && (action.name === approvalActionName)) {                    
                    // found our match!
                    foundApprovalAction = {stageName : stage.name, actionName : action.name, pipelineName : pipelinename, customdata : action.configuration.CustomData};
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
            
            // console.log(JSON.stringify(data));
      
            // lets find any approval action that is in state waiting
            for(var stageIx = 0;stageIx < data.stageStates.length; stageIx++) {
                var stage = data.stageStates[stageIx];
                if(stage.stageName === foundApprovalAction.stageName) {
                    // console.log("found stage name ");
                    for(var actionStageIx = 0;actionStageIx < stage.actionStates.length; actionStageIx++) {
                        var actionStage = stage.actionStates[actionStageIx];
                        
                        if( (actionStage.actionName === foundApprovalAction.actionName)) {

                            // console.log("found matching actionname" + JSON.stringify(actionStage));
                            
                            if(actionStage.hasOwnProperty("latestExecution") && 
                               (actionStage.latestExecution.status === "InProgress")) {
                                // we found our stage that matches the comment and that is currently in progress

                                if(actionStage.latestExecution.hasOwnProperty("token"))
                                    foundApprovalAction.token = actionStage.latestExecution.token;
                                    
                                // console.log("found match - " + JSON.stringify(foundApprovalAction));
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

/**
 * either downloads the inputartifact or the uri
 * @param {Object} inputArtifact 
 * @param {Object} artifactCredentials 
 * @param {String} uri 
 * @param {Function} callback 
 *  callback(err, downloadcontent)
 */
exports.downloadFile = function(inputArtifact, artifactCredentials, uri, callback) {
    
    if(inputArtifact) {
        console.log("inputArtifact: " + JSON.stringify(inputArtifact));
    }
    if(artifactCredentials) {
        console.log("artifactCredentials: " + JSON.stringify(artifactCredentials));
    }

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
        console.log("download file from " + uri);
        
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

/**
 * Uploads the content to the output artifact!
 * @param {Object} outputArtifact 
 * @param {Object} artifactCredentials 
 * @param {String} filename 
 * @param {String} content 
 * @param {Function} callback 
 */
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
        callback("No Valid File to Download", null);
    }
}
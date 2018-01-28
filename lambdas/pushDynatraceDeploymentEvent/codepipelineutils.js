var AWS = require('aws-sdk');
var https = require('https');

var codepipeline = new AWS.CodePipeline();
var codedeploy = new AWS.CodeDeploy();

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

/**
 * returns informaiton about the deployment group, e.g: latest successful deployment
 * 
 */ 
exports.getCodeDeployDeploymentGroupInfo = function(applicationName, deploymentGroupName, callback) {
    codedeploy.getDeploymentGroup({applicationName : applicationName, deploymentGroupName : deploymentGroupName}, function(err, deploymentGroupData) {
        if(err) {callback(err, null); console.log("getDeploymentGroup failed: " + err); return;}
        
        callback(null, deploymentGroupData);
    });
}

/**
 * Returns information about the CodeDeploy Action IF found in the stage of the pipeline
 */ 
exports.getCodeDeployDetails = function(pipelineName, stageName, callback) {
    
    console.log("getCodeDeployDetails: " + pipelineName + ", " + stageName);
    
    // lets find the first CodeDeploy Action in the same Pipeline Stage
    codepipeline.getPipeline({name: pipelineName}, function(err, pipelineData) {
        if(err) {callback(err, null); console.log("getPipeline failed: " + err); return;} 
        
        console.log(JSON.stringify(pipelineData));
        for(var stageIx=0;stageIx<pipelineData.pipeline.stages.length;stageIx++) {
            var stage = pipelineData.pipeline.stages[stageIx];
            
            console.log(stage.name + " == " + stageName);
            
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
                            
                            console.log(codedeploy);
                            
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

// retrieve more CodePipeline Details from a Job Id
/**
 * @param {String} cpjobid
 *  returns information about this job
 * @param {Boolean} addCodeDeployDetails
 *  if True then we are looking for the first CodeDeploy confiugration in the same Pipeline Stage. If one exists we also return informaton about the last CodeDeploy Execution
 * @param {Function) callback
 * 
 * @return err, data
 *  where data is a jobDetails object with pipelineName, stage, action and optionally codedeploy.application, codedeploy.revision, codedeploy.
 * 
 */
exports.getJobDetails = function(cpjobid, addCodeDeployDetails, callback) {
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
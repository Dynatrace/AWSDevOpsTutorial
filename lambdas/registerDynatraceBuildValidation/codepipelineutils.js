var AWS = require('aws-sdk');
var https = require('https');

var codepipeline = new AWS.CodePipeline();

// Notify AWS CodePipeline of a successful job
exports.putJobSuccess = function(message, cpjobid, context) {
    console.log("putJobSuccess: " + cpjobid);
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
            
            var pipelineData = data["jobDetails"]["data"];
            var pipelineContext = pipelineData["pipelineContext"];
            
            var jobDetails = {
                pipelineName : pipelineContext["pipelineName"],
                stage: pipelineContext["stage"]["name"],
                action: pipelineContext["action"]["name"],
            }
            
            if(pipelineData["outputArtifacts"] && pipelineData["outputArtifacts"].length > 0) {
                jobDetails.outputArtifact = pipelineData["outputArtifacts"][0];
                jobDetails.artifactCredentials = pipelineData["artifactCredentials"];
            }
            
            callback(null, jobDetails);      
        }
    });
}

// either downloads the inputartifact or the uri
// callback(err, downloadcontent)
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
    } else {
        callback("No Valid File to Download", null);
    }
}
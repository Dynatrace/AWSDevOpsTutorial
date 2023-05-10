var dtApiUtils = require('utils/dtapiutils');
var AWS = require('aws-sdk');

var defaultTimespan = 60*60*1000; // =60Min*60Sec*1000 == Milliseconds

/**
 * Handles Dynatrace Problem Notifications
 * event.body = {\n\"State\":\"OPEN\",\n\"ProblemID\":\"TESTID\",\n\"ProblemTitle\":\"Dynatrace problem notification test run\",\n\"ImpactedEntities\" : [{ \"type\" : \"HOST\", \"name\" : \"MyHost1\", \"entity\" : \"HOST-XXXXXXXXXXXXX\" }, { \"type\" : \"SERVICE\", \"name\" : \"MyService1\", \"entity\" : \"SERVICE-XXXXXXXXXXXXX\" }]\n}",
 * 
 * If there is an ImpactedEntities List on the problem details we check these entitites. Otherwise we call the Dynatrace Problem API for more details on Impacted Entities
 */ 
exports.handler = (event, context, callback) => {

    var response = {
        statusCode: 400,
        headers : { "content-type" : "text/html" },
        body: ""
    };

    if(!event.body || !event.body.trim().startsWith("{")) {
        response.body = "Method expects a Dynatrace Problem Notification Lambda Object in the Post Body";
        callback(null, response);
        return;
    }
    
    console.log("POSTED BODY");
    console.log(event.body);

    var notificationObject = JSON.parse(event.body);
    // Lets make sure we have the mandatory fields
    if(!notificationObject.PID) {
        response.statusCode = 400;
        response.body = "Missing PID";
        callback(null, response);
        return;
    }
    if(!notificationObject.ImpactedEntities) {
        response.statusCode = 400;
        response.body = "Missing ImpactedEntities";
        callback(null, response);
        return;
    }
    if(!notificationObject.State) {
        response.statusCode = 400;
        response.body = "Missing State";
        callback(null, response);
        return;
    }
    
    // this indicates a Dynatrace Test Message - we just return that everything is OK
    if(event.body.includes("XXXXXXXXXXXXX")) {
        response.statusCode = 200;
        callback(null, response);
        return;
    }

    // we only do a rollback in case a new problem opens up. any other state, e.g: RESOLVED, MERGED doesnt require any action
    if(!notificationObject.State.startsWith("OPEN")) {
        response.statusCode = 200;
        response.body = "Nothing to do as problem status is " + notificationObject.State;
        callback(null, response);
        return;
    }


    // looks like we have all the data we need - now lets see what we can do with it!    
    dtApiUtils.dtApiInit(function(err,data) {
        
        var impactedEntities = [];
        console.log("notificationObject.ImpactedEntities: " + notificationObject.ImpactedEntities);
        for(var entityIx=0;entityIx<notificationObject.ImpactedEntities.length;entityIx++) {
            // var myEntity = JSON.parse(notificationObject.ImpactedEntities[entityIx]);
            var myEntity = notificationObject.ImpactedEntities[entityIx];
            console.log("notificationObject.ImpactedEntities[entityIx]: "+ myEntity.entity);
            impactedEntities.push(myEntity.entity);
        }
        
        console.log("Impacted Entities: " + impactedEntities);
        fixMostRecentDeploymentsOnEntities(impactedEntities, defaultTimespan, function(err, fixedEvents) {
            
            // we have our information and can now iterate and update the problem ticket
            for(var fixedEventIx=0;fixedEventIx<fixedEvents.length;fixedEventIx++) {
                var fixedEvent = fixedEvents[fixedEventIx];
                
                // post codedeployresult back to Dynatrace Problem
                var commentBody = {
                    comment : fixedEvent.CodeDeployResponse,
                    user : "Dynatrace Lambda Remediation Action",
                    context : "AWS Lambda"
                }
                
                var fullUrl = dtApiUtils.getDtTenantUrl() + "/api/v1/problem/details/" + notificationObject.PID + "/comments";
                // console.log("Comment URL: "+ fullUrl);
                // console.log("Comment Body: " + JSON.stringify(commentBody));
                dtApiUtils.dtApiPost(fullUrl, dtApiUtils.getDtApiToken(), commentBody, function(statusCode, data) {
                    console.log("Push Comment to Dynatrace: " + fullUrl + " " + statusCode + "-" + data);
                });
            }
            
            // respond to the lambda call 
            console.log(err + data);
            if(err) {
                response.statusCode = 400;
                response.body = err;
            } else {
                response.statusCode = 200;
                response.body = "Executed Handler successfully!";
            }
            callback(null, response);
        });
    });
};

/**
 * This function iterates through the list of entities and uses the Dynatrace Events API to determine whether there have been any Deplyoment Events in the passed timeframe. 
 * If there are it also gets the CodeDeploy Deployment Information and the latest revision. If there was a prevousRevision we also create a new Deployment for that revision
 * If so the callback receives the information about these events and also the information about the new CodeDeploys and the CodeDeployReponse
 * 
 * @param {Array}  entities
 *  list of Dynatrace Entities
 * @param {Number} timespan
 *  timespan in milliseconds that we have to go back in time from NOW()
 */ 
var fixMostRecentDeploymentsOnEntities = function(entities, timespan, callback) {
    if(entities == null || entities.length == 0) {
        console.log("No entities passed to getRecentDeploymentsOnEntities");
        callback(null, null);
        return;
    }
 
    var mostRecentEvents = []
    getMostRecentDeploymentOnEntity(entities, 0, timespan, mostRecentEvents, function(err, mostRecentEvents) {
        // now we iterate through all these events and get the previous deployment revision
        console.log("Found Most Recent Deployment Events: " + mostRecentEvents.length);
        
        // now we find all the CodeDeploy Information
        findCodeDeployDeploymentInformation(mostRecentEvents, 0, function(err, data) {
            
            // now we create a new Deployment based on previous revision
            deployPreviousRevisions(mostRecentEvents, 0, function(err, data) {
                callback(err, mostRecentEvents);
            });
        });
    });
}

/**
 * iterates through the list and will create a new deployment based on the inforamtion on the event
 */ 
var deployPreviousRevisions = function(mostRecentEventsWithDeployData, index, callback) {
    
    var codedeploy = new AWS.CodeDeploy();
    
    var deployEventWithDeployData = mostRecentEventsWithDeployData[index];
    if(deployEventWithDeployData != null) {
        var params = {
            applicationName : deployEventWithDeployData.CodeDeploy.deploymentInfo.applicationName,
            deploymentConfigName :  deployEventWithDeployData.CodeDeploy.deploymentInfo.deploymentConfigName,
            deploymentGroupName :  deployEventWithDeployData.CodeDeploy.deploymentInfo.deploymentGroupName,
            description : "Automatic Deployment from Dynatrace Remediation Action. Previous Deployment " + deployEventWithDeployData.CodeDeploy.deploymentInfo.deploymentId + " caused a problem",
            revision :  deployEventWithDeployData.CodeDeploy.deploymentInfo.previousRevision
        }
        
        console.log("CodeDeploy Info: " + JSON.stringify(deployEventWithDeployData.CodeDeploy));
        console.log("Lets deploy: " + JSON.stringify(params));
        
        // lets validate we have a validate revision!
        if(params.revision == null) {
            deployEventWithDeployData.CodeDeployResponse = "COULDNT find previous CodeDeploy Deployment! No rollback possible";
            console.log("createDeployment failed: COULDNT find previous CodeDeploy Deployment!");
            index++;
            if(index < mostRecentEventsWithDeployData.length) {
                deployPreviousRevisions(mostRecentEventsWithDeployData, index, callback);
            } else {
                callback(null, mostRecentEventsWithDeployData);
            }
        }
        else { 
            // now lets deploy it!
            codedeploy.createDeployment(params, function(err, data) {
                if(err) {
                    deployEventWithDeployData.CodeDeployResponse = err;
                    console.log("createDeployment failed: " + err);
                } else {
                    deployEventWithDeployData.CodeDeployResponse = "Created new Deployment: " + data.deploymentId;
                    console.log("createDeployment succeeded: " + data.deploymentId);
                }
                
                // call ourself recursively if we have more work - otherwise call callback
                index++;
                if(index < mostRecentEventsWithDeployData.length) {
                    deployPreviousRevisions(mostRecentEventsWithDeployData, index, callback);
                } else {
                    callback(null, mostRecentEventsWithDeployData);
                }
            });
        }
    } else {
        // call ourself recursively if we have more work - otherwise call callback
        index++;
        if(index < mostRecentEventsWithDeployData.length) {
            deployPreviousRevisions(mostRecentEventsWithDeployData, index, callback);
        } else {
            callback(null, mostRecentEventsWithDeployData);
        }        
    }
}

/**
 * Recursively iterates through the event and find the previous deploymentId for the referenced deployment
 * adds a "CodeDeploy" object to the event. Key items are: deploymentInfo, previousRevision
 */ 
var findCodeDeployDeploymentInformation = function(mostRecentEvents, index, callback) {
    var codedeploy = new AWS.CodeDeploy();
    
    var event = mostRecentEvents[index];
    if((event != null) && event.customProperties) {
        codedeploy.getDeployment({deploymentId : event.customProperties["CodeDeploy.DeploymentId"]}, function(err, data) {
            // lets see if there is a rollback deployment

            console.log("getDeployment: " + JSON.stringify(data));
            
            event.CodeDeploy = data;
        
            index++;
            if(index < mostRecentEvents.length) {
                findCodeDeployDeploymentInformation(mostRecentEvents, index, callback);
            } else {
                callback(null, null);
            }
        });
    } else {
        index++;
        if(index < mostRecentEvents.length) {
            findCodeDeployDeploymentInformation(mostRecentEvents, index, callback);
        } else {
            callback(null, null);
        }
    }
}

/**
 * returns the most recent CUSTOM_DEPLOYMENT event on these passesd entites where the event.source==AWS CodePipeline
 */ 
var getMostRecentDeploymentOnEntity = function(entities, index, timespan, resultEvents, callback) {
    var dtEventUrl = dtApiUtils.getDtTenantUrl() + "/api/v1/events";

    var entity = entities[index];
    var to = Date.now();
    var from = to - timespan;
    var queryString = "?entityId=" + entity + "&eventType=CUSTOM_DEPLOYMENT";
    if(timespan != null && timespan > 0) queryString += "&to=" + to + "&from=" + from;
    
    console.log("Executing Query: " + queryString);
    dtApiUtils.dtApiPost(dtEventUrl + queryString, dtApiUtils.getDtApiToken(), null, function(statusCode, data) {
        // if we got a list of events only look at the most recent one that came from CodePipeline
        if(statusCode == 200 && data) {
            var events = JSON.parse(data).events;
            // May 2nd 2018: changed iteration as it seems Problem Events REST API is now automatically sorting events descending timeorder. this used to be different. I want to find the "newest" AWS CodePipeline deployment
            // for(var eventIx=events.length-1;eventIx>=0;eventIx--) {
            for(var eventIx=0;eventIx<events.length;eventIx++) {
                var event = events[eventIx];
                if(event.source == "AWS CodePipeline") {
                    // only push it if the same deploymentId is not already on the list, e.g: if a deployment deployes to multiple instances we only need the deployment once
                    for(var resultIx=0;resultIx<resultEvents.length;resultIx++) {
                        if(resultEvents[resultIx].customProperties["CodeDeploy.DeploymentId"] == event.customProperties["CodeDeploy.DeploymentId"]) {
                            break;
                        }
                    }
                    resultEvents.push(event);
                    break;
                }
            }
        }
    
        // process next entry if there is more. otherwise return
        index++;
        if(index >= entities.length) {
            callback(null, resultEvents);
            return;
        }
        
        getMostRecentDeploymentOnEntity(entities, index, timespan, resultEvents, callback);
    });     
}

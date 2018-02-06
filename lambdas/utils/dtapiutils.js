var https = require("https");
var url = require("url");
var AWS = require('aws-sdk');

/**
 * Global Variables used by these Dynatrace Helper Functions
 * These variables will be initialized upon first usage or when dtInit gets called
 * @property dtApiToken
 *  Token used to make REST Calls to the Dynatrace API
 * @property dtTenantUrl
 *  This is the Dynatrace Tenant URL. For SaaS it would be https://yourtenant.live.dynatrace.com for Managed it would be http://yourmanagedtenant/e/yourenvid
 * @property dtBuildReportUrl
 *  This is the URL to the Build Status Report
 */
var dtApiToken = null;
var dtTenantUrl = null;
var dtBuildReportUrl = null;

/**
 * TODO: Once AWS Provides Node8+ we have to switch to using async/await to make sure we wait for the return values
 * @param {*} paramName 
 * @param {*} cachedValue 
 * @param {*} callback 
 * @returns the value of a parameter. parameter can either be specified as an env variable or a system parameter
 */
var getSystemParameter = /*async*/function(paramName, cachedValue, callback) {
    if(cachedValue && (cachedValue != null)) {
        if(callback) callback(null, cachedValue);
        return cachedValue;
    }
    
    if(process.env[paramName]) {
        cachedValue = process.env[paramName];
        if(callback) callback(null, cachedValue);
    } else {
        var ssm = new AWS.SSM();
        /*await*/ssm.getParameter({Name : paramName}).promise()
        .then(data => { 
            cachedValue = data.Parameter["Value"];
            console.log("Successfully retrieved " + paramName + ": " + cachedValue);
            if(callback) callback(null, cachedValue);
        })
        .catch(err => { 
            console.log("Error Retrieving " + paramName + ": " + err);
            cachedValue = null;
            if(callback) callback(err, null);
        });
    }
    
    return cachedValue;
}

/**
 * @returns returns dynatrace api token
 */
exports.getDtApiToken = /*async*/ function() {
    dtApiToken = getSystemParameter('DT_API_TOKEN', dtApiToken);
    return dtApiToken;
}

/**
 * @returns returns dynatrace tenant url
 */
exports.getDtTenantUrl = function() {
    dtTenantUrl = getSystemParameter('DT_TENANT_URL', dtTenantUrl);

    // lets make sure the URL doesnt have the trailing / in the end as otherwise we may construct wrong full URLs when adding the api URI
    if(dtTenantUrl.endsWith("/")) {
        dtTenantUrl = dtTenantUrl.substr(0, dtTenantUrl.length - 1);
    }

    return dtTenantUrl;
}

/**
 * @returns returns the url to the dynatrace build report API Gateway which was created by cloudformation
 */
exports.getDtBuildReportUrl = function() {
    dtBuildReportUrl = getSystemParameter('DT_BUILD_REPORT_URL', dtBuildReportUrl);
    return dtBuildReportUrl;
}

/**
 * This will initialize the Dynatrace API Helper Library
 * Right now this is mainly used to "prime" our API Token and URL - which should no longer be needed when AWS Upgrades Node.js to Node8
 * until node8 pleas call init and only proceed with your work if callback returns no error
 */
exports.dtApiInit = function(callback) {
    getSystemParameter('DT_API_TOKEN', dtApiToken, function(err, data) {
        if(err) {callback(err, null); return;}
        dtApiToken = data;
        
        getSystemParameter('DT_TENANT_URL', dtTenantUrl, function(err, data) {
            if(err) {callback(err, null); return};
            dtTenantUrl = data;

            getSystemParameter('DT_BUILD_REPORT_URL', dtBuildReportUrl, function(err, data) {
                if(err) {callback(err, null); return};
                dtBuildReportUrl = data;
                callback(null, "OK");
            });
        });
    });
}

/**
 * Makes a call to the Dynatrace REST API. 
 * @param {String} dtUrl
 *  This should be the FULL Url to the rest api, e.G: http://yourtenant.live.dynatrace.com/api/v1/events
 *  You can get the base URL via exports.getDtTenantUrl
 * @param {String} dtToken
 *  This is the API Token. You can get the configured token via exports.getDtApiToken
 * @param {String} body
 *  If specified we make an HTTP POST call and this becomes the body. If NULL we make an HTTP GET call
 * @param {Function} callback(statusCode, responseBody)
 *  check statusCode on 200 for success
 */
exports.dtApiPost = function(dtUrl, dtToken, body, callback) {
    console.log("dtApiPost: " + dtUrl);
    
    var fullUrl = url.parse(dtUrl);
    var bodyString = body == null ? "" : JSON.stringify(body);
    
    // An object of options to indicate where to post to
    var post_options = {
      host: fullUrl.host,
      path: fullUrl.path,
      method: body == null ? 'GET' : 'POST',
      headers: {
          'Authorization': 'Api-Token ' + dtToken,
          'Content-Length': Buffer.byteLength(bodyString),
          'Content-Type' : 'application/json'
      }
    };

    // Set up the request
    var post_req = https.request(post_options, function(res) {
        var responseBody = "";
        res.setEncoding('utf8');
        res.on('data', function (chunk) {
            responseBody += chunk;
        });
        res.on('end', function() {
            callback(res.statusCode, responseBody);
        });
    });

    // post the data
    if(body != null) post_req.write(bodyString);
    post_req.end();
}

/**
 * will return a list of found entities
 * @param {String} entitytype 
 *  allowed values are service, services, host, hosts, process-groups, applications
 * @param {Array} tags 
 *  for tags we allow a list of tags as as described in attachRules
 * @param {Number} timefrom 
 * @param {Number} timeto 
 * @param {Boolean} fulldetails 
 *  if fulldetails = true then we return the full result from the Dynatrace REST API - otherwise just the list of EntityIDs
 * @param {*} callback 
 */
exports.queryEntities = function(entitytype, tags, timefrom, timeto, fulldetails, callback) {
    // we first have to build the URI, e.g: 
    var baseuri = null;
    switch(entitytype) {
        case "services":
        case "service" : 
            baseuri = "/api/v1/entity/services"; 
            break;
        case "hosts":
        case "host":
            baseuri = "/api/v1/entity/infrastructure/hosts";
            break;
        case "process-groups":
        case "process-group":
            baseuri = "/api/v1/entity/infrastructure/process-groups";
            break;
        case "applications":
        case "application":
            baseuri = "/api/v1/entity/applications";
            break;
    }
    
    if(baseuri == null) {
        console.log("ERROR: entitytype " + entitytype + " not supported!");
        callback("entitytype " + entitytype + " not supported", null);
        return;
    }
    
    // now lets iterate through the list of tags (if passed) and create the actual query string representation
    var tagQuery = "";
    if (tags) {
        tags.forEach(function(element) {
            if(tagQuery) tagQuery += " AND ";
            if(element.context && !element.context === "CONTEXTLESS") tagQuery += ("[" + element.context + "]");
            if(element.key) tagQuery += (element.key + ":");
            if(element.value) tagQuery += element.value;
        });
    }
    
    // create our full HTTP GET URL
    var fullDtUrl = exports.getDtTenantUrl() + baseuri;
    var connKey = "?";
    if(tagQuery) {fullDtUrl += connKey + "tag=" + tagQuery;connKey = "&";}
    if(timefrom) {fullDtUrl += connKey + "startTimestamp=" + timefrom;connKey = "&";}
    if(timeto) fullDtUrl += connKey + "endTimestamp=" + timeto;
    
    // now lets call the Dynatrace API
    exports.dtApiPost(fullDtUrl, exports.getDtApiToken(), null, function(statusCode, data) {
        if(statusCode > 299) {
            console.log("Dynatrace API Call failed: " + statusCode + " " + data);
            callback(statusCode, null);
            return;
        }
        
        console.log("Dynatrace API Call returned: " + data);
        var searchResult = JSON.parse(data);
        if(fulldetails) {
            callback(null, searchResult);
            return;
        }

        // caller doesnt want full details so we deliver just the entity ids
        var foundEntities = [];
        searchResult.forEach(function(element) {
            if(element.entityId) foundEntities.push(element.entityId); 
        });
        console.log("All found entityids: " + JSON.stringify(foundEntities));
        callback(null, foundEntities);
        return;
    });
}

/**
 * TODO: right now only allows one timeseries
 * returns the timeseries data based on the passed parameters
 * querymode: series or total
 * aggregation: 
 * @param {*} tsId
 *  timeseriesID, e.g: com.dynatrace.builtin:app.actionspersession
 * @param {*} entities
 *  String Array of Entities
 * @param {*} timefrom
 *  Timestamp in milliseconds
 * @param {*} timeto 
 *  Timestamp in milliseconds
 * @param {*} querymode 
 *  series or total
 * @param {*} aggregation
 *  avg, min, max, count, sum, median, pXX
 * @param {*} callback 
 *  
 */
exports.getTimeseries = function(tsId, entities, timefrom, timeto, querymode, aggregation, callback) {
    
    if(!tsId) {
        callback("timeseries is required", null);
        return;
    }
    
    // build our post body
    var postBody = {
        timeseriesId : tsId
    };
    
    if(entities) postBody.entities = entities;
    if(timefrom) postBody.startTimestamp = timefrom;
    if(timeto) postBody.endTimestamp = timeto;
    if(querymode) postBody.queryMode = querymode;
    if(aggregation) {
        if(aggregation.startsWith("p")) {
            postBody.aggregationType = "percentile";
            postBody.percentile = aggregation.substr(1);
        } else {
            postBody.aggregationType = aggregation;
        }
    }
    
    // Lets call the timeseries API
    exports.dtApiPost(exports.getDtTenantUrl() + "/api/v1/timeseries", exports.getDtApiToken(), postBody, function(statusCode, data) {
        if(statusCode > 299) {
            console.log("Dynatrace API Call failed: " + statusCode + " " + data);
            callback(statusCode, null);
            return;
        }
        
        console.log("Timeseries API succeeded for " + JSON.stringify(postBody) + " we received " + data);
        callback(null, JSON.parse(data));
        return;
    });
}
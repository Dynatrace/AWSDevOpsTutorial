var https = require("https");
var url = require("url");
var AWS = require('aws-sdk');

// global variables
var dtApiToken = null;
var dtTenantUrl = null;
var dtBuildReportUrl = null;

// TODO: Once AWS Provides Node8+ we have to switch to using async/await to make sure we wait for the return values
// returns the value of a parameter. parameter can either be specified as an env variable or a system parameter
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

// returns dynatrace api token
exports.getDtApiToken = /*async*/ function() {
    dtApiToken = getSystemParameter('DT_API_TOKEN', dtApiToken);
    return dtApiToken;
}

// returns dynatrace tenant url
exports.getDtTenantUrl = function() {
    dtTenantUrl = getSystemParameter('DT_TENANT_URL', dtTenantUrl);
    return dtTenantUrl;
}

// returns the url to the dynatrace build report API Gateway which was created by cloudformation
exports.getDtBuildReportUrl = function() {
    dtBuildReportUrl = getSystemParameter('DT_BUILD_REPORT_URL', dtBuildReportUrl);
    return dtBuildReportUrl;
}

// This will initialize the API
// right now this is mainly used to "prime" our API Token and URL - which should no longer be needed when AWS Upgrades Node.js to Node8
// unti node8 pleas call init and only proceed with your work if callback returns no error
exports.dtApiInit = function(callback) {
    getSystemParameter('DT_API_TOKEN', dtApiToken, function(err, data) {
        if(err) {callback(err, null); return;}
        dtApiToken = data;
        
        getSystemParameter('DT_TENANT_URL', dtTenantUrl, function(err, data) {
            if(err) {callback(err, null); return};
            dtTenantUrl = data;
            callback(null, "OK");
        });
    });
}

// posts to the Dynatrace REST API. If body is null we do a GET - otherwise a POST
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

// will return a list of found entities
// allowed values for entitytype: service, host
// for tags we allow a list of tags as used for attachRules
// if fulldetails = true then we return the full result from the Dynatrace REST API - otherwise just the list of EntityIDs
exports.queryEntities = function(entitytype, tags, timefrom, timeto, fulldetails, callback) {
    // we first have to build the URI, e.g: 
    var baseuri = null;
    if (entitytype === "services" || entitytype === "service") baseuri = "/api/v1/entity/services";
    else if (entitytype === "hosts" || entitytype === "host") baseuri = "/api/v1/entity/infrastructure/hosts"
    
    if(baseuri == null) {
        callback("Not supported entitytype", null);
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

// TODO: right now only allows one timeseries

// returns the timeseries data based on the passed parameters
// querymode: series or total
// aggregation: avg, min, max, count, sum, median, percentiles
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
    if(aggregation) postBody.aggregationType = aggregation;
    
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
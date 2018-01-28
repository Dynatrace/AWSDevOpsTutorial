var https = require("https");
var url = require("url");
var AWS = require('aws-sdk');

// global variables
var dtApiToken = null;
var dtTenantUrl = null;

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

// posts to the Dynatrace REST API
exports.dtApiPost = function(dtUrl, dtToken, body, callback) {
    
    var fullUrl = url.parse(dtUrl);
    var bodyString = JSON.stringify(body);
    
    // An object of options to indicate where to post to
    var post_options = {
      host: fullUrl.host,
      path: fullUrl.path,
      method: 'POST',
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
    post_req.write(bodyString);
    post_req.end();
}

// posts to the Dynatrace REST API
exports.dtApiGet = function(dtUrl, dtToken, dtQueryString, callback) {
    
    var fullUrl = url.parse(dtUrl +  dtQueryString);

    // An object of options to indicate where to post to
    var get_options = {
      host: fullUrl.host,
      path: fullUrl.path,
      method: 'GET',
      headers: {
          'Authorization': 'Api-Token ' + dtToken,
      }
    };

    // Set up the request
    var get_req = https.request(get_options, function(res) {
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
    get_req.end();
}

/* here is the sample structure of a monspec file
{
    "SampleJSonService" : {
        "etype": "SERVICE",
        "_comment_etype" : "Options are SERVICE, APPLICATION, HOST, PROCESS_GROUP_INSTANCE",
        "_resolved_entities" : { "Staging" : [ENTITY1, ENTITY2], "Production" : [ENTITY3, ENTITY 4]} <<-- THIS WILL BE FILLED from Dynatrace in the output monspec
        "_resolved_comparison" : "StagingToProduction" <<-- will be filled with the actual comparision configuration name we used
        "_resolved_status" : "OK, FAILED, .." << -- THIS WILL BE FILLED
        "name": "SampleNodeJsService",
        "_comment" : "This defines our initial thoughts about monitoring!",
        "environments" : { 
            "Staging" : {
                "tags" : [
                    {
                        "context": "CONTEXTLESS",
                        "key": "DeploymentGroup", 
                        "value": "Staging"
                    }                
                ]
            },
            "Production" : {
                "tags" : [
                    {
                        "context": "CONTEXTLESS",
                        "key": "DeploymentGroup", 
                        "value": "Production"
                    }                
                ]                
            }
        },
        "_comment_environments" : "Allows you to define different environments and the ways dynatrace can identify the entities in that environment",
        "comparisons" : [
            { 
                "name" : "StagingToProduction",
                "source" : "Staging",
                "compare" : "Production",
                "scalefactorperc" : {
                    "default": -10,
                    "com.dynatrace.builtin:service.requestspermin" : -90
                },
                "shiftcomparetimeframe" : 0,
                "shiftsourcetimeframe" : 0,

                "_comment_name" : "Name of that comparison setting. Needs to be specified when using this file with our automation scripts",
                "_comment_source" : "source entites. we compare timeseries from this entity with compare",
                "_comment_compare": "compare entites. basically our baseline which we compare source against",
                "_comment_scalefactorperc" :  "+/-(0-100)% number: if -10 it means that source can be 10% less than baseline. you can define a default value but override it for individual measure, e.g: if Staging has 90% less traffic that prod you can define that here",
                "_comment_shiftsourcetimeframe" : "allows you to define a shifted timeframe back to NOW(). Its in seconds, e.g: 600 means we compare against 10 minutes ago",
                "_comment_shiftcomparetimeframe" : "allows you to define a shifted timeframe to NOW(). Its in seconds, e.g: 86400 means we compare against same time 1 day ago"
            },
            { 
                "name" : "StagingToProductionYesterday",
                "source" : "Staging",
                "compare" : "Production",
                "scalefactorperc" : {
                    "default": -10,
                    "com.dynatrace.builtin:service.requestspermin" : -90
                },
                "shiftsourcetimeframe" : 0,
                "shiftcomparetimeframe" : 86400
            },
            { 
                "name" : "StagingToStagingLastHour",
                "source" : "Staging",
                "compare" : "Staging",
                "scalefactorperc" : { "default": 0},
                "shiftsourcetimeframe" : 0,
                "shiftcomparetimeframe" : 3600
            }           
        ],
        "_comment_comparisons" : "Allows you to define different comparison configurations which can be used to automate comparison between environments and timeframes",
        "perfsignature" : [
            { 
                "timeseries" : "com.dynatrace.builtin:service.responsetime",
                "aggregate" : "avg",
                "_upperlimit" : 100,
                "_lowerlimit" : 50,
                "_comment_aggregate" : "Depending on the metric can be: min, max, avg, sum, median, count, percentile",
                "_comment_upperlimit" : "if specified we compare against this static threshold - otherwise against what is specified in comparison",
                "_comment_lowerlimit" : "if specified, we compare against this static threshold - otherwise against what is specified in comparison"
            },
            { 
                "timeseries" : "com.dynatrace.builtin:service.responsetime",
                "aggregate" : "max"
            },
            { 
                "timeseries" : "com.dynatrace.builtin:service.failurerate",
                "aggregate" : "avg"
            },
            { 
                "timeseries" : "com.dynatrace.builtin:service.requestspermin",
                "aggregate" : "count"
            }
        ],
        "_comment_perfsignature" : "this is the list of key metrics that make up your performance signature. we will then compare these metrics against the compare enviornment or a static threshold",
        "servicemethods" : [
            { 
                "name" : "/api/invoke",
                "perfsignature" : [
                    { 
                        "timeseries" : "com.dynatrace.builtin:servicemethod.responsetime",
                        "aggregate" : "avg"
                    },
                    { 
                        "timeseries" : "com.dynatrace.builtin:servicemethod.responsetime",
                        "aggregate" : "max"
                    },
                    { 
                        "timeseries" : "com.dynatrace.builtin:servicemethod.failurerate",
                        "aggregate" : "avg"
                    }
                ]
            }
        ],
        "_comment_servicemethods" : "Allows you to define key metrics of individual service methods and not just the service itself"
    }
}

{
    "ConfigurationName" : {
        "etype": "SERVICE",
        "name": "SampleNodeJsService",
        "entities" : [ABCD, ABDD]  <-- THIS WE FILL OUT
        "tags" : [
            {
                "context": "CONTEXTLESS",
                "key": "DeploymentGroup", 
                "value": "Staging"
            },
            ...
        ],
        "perfsignature" : [
            { 
                "timeseries" : "com.dynatrace.builtin:service.responsetime:service.responsetime",
                "aggregate" : "avg",
                "upperlimit" : 100,
                "actualSourceValue" : 88   <-- THIS WE WILL OUT
            },
            ...
        ],
        "servicemethods" : [
            { 
                "name" : "/api/invoke",
                "perfsignature" : [
                    { 
                        "timeseries" : "com.dynatrace.builtin:servicemethod.responsetime",
                        "aggregate" : "avg",
                        "upperlimit" : 80,
                        "actualSourceValue" : 85   <-- THIS WE WILL OUT
                    },
                    ...
                ]
            }
        ]
    }
}
*/

/**
 * This function will return all tagRules that are defined for the passed enviornmentname. if environment is null it will return ALL tagrules from the complete monspec object
 * @param {object} monspec
 *  is the monspec object
 * @param {String} environmentname
 *  is the name of the environment that is configured within monspec. if null we return all of them
 * @return {Array} 
 *  array of tagRule objects
 * */
exports.getAllTagRules = function (monspec, environmentname) {
    var tagRules = [];
    for (var property in monspec) {
        if (monspec.hasOwnProperty(property)) {
            var entityDef = monspec[property];

            if(entityDef.environments) {
                for(var envname in entityDef.environments) {
                    if(entityDef.environments.hasOwnProperty(envname) &&
                       ((environmentname === envname || environmentname == null))) {
                        var envDef = entityDef.environments[envname];
                        if(envDef.tags) {
                            var tagRule = {
                                "meTypes" : [ entityDef.etype ],
                                "tags" : envDef.tags
                            };
                            tagRules.push(tagRule);
                        }
                    }
                }
            } else {
                console.log("Monspec file doesnt have environments specified!")
            }
        }
    }
    
    console.log("Returned following tagRules: " + JSON.stringify(tagRules));
    return tagRules;
}

// returns a list of top level configuration names
/**
 * @param {object} monspec
 * @return {Array} list of configuration names
 * */
exports.getAllConfigurationNames = function(monspec) {
    var configurationNames = [];
    
    for (var property in monspec) {
        if (monspec.hasOwnProperty(property))
            configurationNames.push(property);
    }
    
    return configurationNames;
}

/**
 * @param {object} monspec
 * @param {String} comparisonconfigname
 *  The name of the comparision configuration name
 **/
exports.getComparisonConfiguration = function(entityDef, comparisonconfigname) {
    if(!entityDef.comparisons) {
        console.log("No comparison configuration for this entityDef: " + JSON.stringify(entityDef));
        return null;
    }

    for(var configIx=0; configIx < entityDef.comparisons.length; configIx++) {
        var comparisonConfig = entityDef.comparisons[configIx];
        if(comparisonConfig.name === comparisonconfigname)
            return comparisonConfig;
    }   

    return null;
}

/**
 * iterates through all configuration entries and counts the number of status violations!
 * @return {Number} 
 */
exports.getNumberOfViolatedConfigurations = function(monspec) {
    var configNames = exports.getAllConfigurationNames(monspec);
    var violationCount = 0;
    for(var configIx = 0;configIx < configNames.length;configIx++) {
        if(monspec[configNames[configIx]].status == exports.MONSPEC_VIOLATION_STATUS_VIOLATION)
            violationCount++;
    }
    
    return violationCount;
}

// iterates through monspec and returns the next element that has to be filled with live data
// returns an array with either
// -   

exports.FILLTASK_FIELD_RESOLVED_ENTITIES = "_resolved_entities";
exports.FILLTASK_FIELD_RESOLVED_COMPARISON = "_resolved_comparison";

exports.FILLTASK_RESOLVE_ENTITIES = "0";
exports.FILLTASK_RESOLVE_PERFSIG = "1";
exports.FILLTASK_RESOLVE_SERVICE_PERFSIG = "2";
exports.getNextMonspecFillTask = function(monspec, callback) {

    var configNames = exports.getAllConfigurationNames(monspec);
    
    for(var configIx=0;configIx<configNames.length;configIx++) {
        var configName = configNames[configIx];
        var entityDefEntry = monspec[configName];
       
        // lets see if this entityDefinition already has resolved entities. if not return the name of this configuration element
        if (!entityDefEntry.hasOwnProperty(exports.FILLTASK_FIELD_RESOLVED_ENTITIES)) {
           callback(
               {
                task:exports.FILLTASK_RESOLVE_ENTITIES,
                configName:configName
               });
           return;
        }
       
        // now lets iterate through the perfsignatures and return the next that doesnt have an actualValue
        if(entityDefEntry.hasOwnProperty("perfsignature")) {
           for(var perfSigIx=0;perfSigIx<entityDefEntry.perfsignature.length;perfSigIx++) {
               var perfSig = entityDefEntry.perfsignature[perfSigIx];
               if(!perfSig.hasOwnProperty("actualSourceValue")) {
                   callback(
                       {
                           task:exports.FILLTASK_RESOLVE_PERFSIG,
                           configName:configName,
                           entities:entityDefEntry[exports.FILLTASK_FIELD_RESOLVED_ENTITIES],
                           perfSigEntry:perfSig
                       });
                   return;
               }
           }
        }
       
        // seems all perfsignatures are filled with actualValues - lets check if there are servicemethod definitions
        if(entityDefEntry.hasOwnProperty("servicemethods")) {
            for(var servIx=0;servIx<entityDefEntry.servicemethods.length;servIx++) {
                var serviceMethodDef = entityDefEntry.servicemethods[servIx];
                if(serviceMethodDef.hasOwnProperty("perfsignature")) {
                    for(var perfSigIx=0;perfSigIx<serviceMethodDef.perfsignature.length;perfSigIx++) {
                        var perfSig = serviceMethodDef.perfsignature[perfSigIx];
                        if(!perfSig.hasOwnProperty("actualSourceValue")) {
                            callback(
                                {
                                    task:exports.FILLTASK_RESOLVE_SERVICE_PERFSIG,
                                    configName:configName,
                                    entities:entityDefEntry[exports.FILLTASK_FIELD_RESOLVED_ENTITIES],
                                    serviceMethodName:serviceMethodDef.name,
                                    perfSigEntry:perfSig
                                });
                            return;
                        }
                    }
                }
            }
        }
    }
    
    callback(null);
};

// Validates if the actual value meets the upper or lower limit
// returns true if no violation or FALSE if violation happens
// if setstatus==true also sets the status message
exports.MONSPEC_VIOLATION_STATUS_VIOLATION = "violation";
exports.MONSPEC_VIOLATION_STATUS_OK = "ok";

/**
 * 
 * @param {object} entityDef
 *  entitydefinitoin from the monspec
 * @param {object} perfSigEntry
 *  the actual performance signature entry that contains all the resolved values
 * @param {object} comparisonConfig
 *  the comparison config that includes scalefactor information
 * @param {Boolean) setstatus
 *  if true sets the status back on the perfSigEntry object
 * 
 */
exports.checkPerfSigEntryViolation = function(entityDef, perfSigEntry, comparisonConfig, setstatus) {
    if(!perfSigEntry.hasOwnProperty("actualSourceValue")) return true;
    
    var returnValue = true;
    
    // first we check if there are hard coded values
    if(perfSigEntry.hasOwnProperty("lowerlimit")) {
        returnValue = perfSigEntry.actualSourceValue > perfSigEntry.lowerlimit;
    } else
    if(perfSigEntry.hasOwnProperty("upperlimit")) {
        returnValue = perfSigEntry.actualSourceValue < perfSigEntry.upperlimit;
    } else {
        var validate = "upper";
        if(perfSigEntry.hasOwnProperty("validate"))
            validate = perfSigEntry.validate;
            
        // we need to validate that actualValue is not higher than the compareValue + the allowed factor
        var scaleFactor = 0;
        if(comparisonConfig.hasOwnProperty("scalefactorperc")) {
            var scalefactorperc = comparisonConfig["scalefactorperc"];
            // lets first check if there is a factor specified for this timeseries. fallback is default
            if(scalefactorperc.hasOwnProperty(perfSigEntry.timeseries)) {
                scaleFactor = scalefactorperc[perfSigEntry.timeseries];
            } else if(scalefactorperc.hasOwnProperty("default")) {
                scaleFactor = scalefactorperc["default"];
            }    
        }
        // console.log("Found Scalefactor " + scaleFactor);
        
        // if we dont have a compare value we use our source value
        if(!perfSigEntry.hasOwnProperty("actualCompareValue")) {
            returnValue = false;
            console.log("Couldnt find compare value - therefore cant compare and default to validation failed!")
        }
        else {
            var actualCompareValue = perfSigEntry.actualCompareValue;
            // this means that we tried to get a compare value but the compareable entites didnt provide any data -> in this case we assume we are GOOD!
            if (actualCompareValue == null) {
                returnValue = true;
            } else 
            if(validate === "upper") {
                // calculate the factor-adjusted upper limit 
                actualCompareValue = actualCompareValue + (actualCompareValue * scaleFactor) / 100;
                perfSigEntry.actualUpperLimit = actualCompareValue;
                returnValue = perfSigEntry.actualSourceValue < perfSigEntry.actualUpperLimit;
            } else {
                // calculate the factor-adjusted lower limit 
                actualCompareValue = actualCompareValue - (actualCompareValue * scaleFactor) / 100;
                perfSigEntry.actualLowerLimit = actualCompareValue;
                returnValue = perfSigEntry.actualSourceValue > perfSigEntry.actualLowerLimit;
            }
        }
    }
    
    // set status for performancesignature but also for complete entry definition
    if(setstatus) {
        perfSigEntry.status = returnValue ? exports.MONSPEC_VIOLATION_STATUS_OK : exports.MONSPEC_VIOLATION_STATUS_VIOLATION;
        
        // set or update global status in case there was no status yet or if status is violation
        if(!entityDef.hasOwnProperty("status") || !returnValue) entityDef.status = perfSigEntry.status;
    }
        
    return returnValue;
}
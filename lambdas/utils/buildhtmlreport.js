/**
 * These are the HTML Templates for generating the HTML Page for getBuildValidationResults
 */
var htmlReportTemplate = 
"<html>" + 
"<head>" + 
"  <title>Dynatrace Build Validation Results</title>" +
"  <script src='https://code.highcharts.com/highcharts.js'>" + 
"  </script><script src='https://code.highcharts.com/modules/exporting.js'></script>" + 
"</head>" + 
"<body>" +
"<h1>Dynatrace Build Validation Results</h1>" + 
"<form action='' method='get'><label for='pipelineName'>Pipeline Name: </label><input type='text' id='pipelineName' name='pipelineName' value='PIPELINENAMEPLACEHOLDER'><label for='comparisonName'>Comparison Configuration: </label><input type='text' id='comparisonName' name='comparisonName' value='COMPARISONNAMEPLACEHOLDER'> <input type='submit' value='Load Data'></form>" +
"CHARTPLACEHOLDER" + 
"</body></html> ";

var htmlChartTemplate = 
"<div id='DIVID'></div><script type='text/javascript'>Highcharts.chart('DIVID', { " +
"    title: {text: 'CHARTTITLE'}, " +
"    chart: { height: 200}," + 
"    yAxis: [{title: {text: 'Values'}}, {title: {text: 'Violations', style: {color: 'red'}}, opposite: true}], " + 
"    xAxis: { categories : XAXISCATEGORIES_PLACEHOLDERS}," +
"    plotOptions: { series: { pointWidth: 5} }," + 
"    legend: {layout: 'vertical',align: 'right',verticalAlign: 'middle'}, " +
"    series: SERIES_PLACEHOLDER" + 
"});" + 
"</script>"

var smallestTimestamp = 0;

/**
 * returns a string that contains a full HTML Page that renders each indiviudal metric in a chart
 * @param {Object} responseDataObject
 *  Object with all timeseries data to render
 * @param {Array}
 */
exports.buildHtmlChartReport = function(responseDataObject, xAxisLabels, pipelineName, comparisonName) {
    
    var allChartsHtml = "";
    
    if(responseDataObject != null) {
        for(var metricIx=0;metricIx<responseDataObject.length;metricIx++) {
            var metricObject = responseDataObject[metricIx];
            
            var metricObjectName = Object.keys(metricObject)[0];
            var metricObjectValues = metricObject[metricObjectName];

            var stringifiedSeries = JSON.stringify(metricObjectValues).replace(/["]/g, "'");
            console.log("REPLACE: " + stringifiedSeries);
            var chartHtml = htmlChartTemplate.replace(/DIVID/g, "Chart_" + metricIx.toString()).replace("CHARTTITLE", metricObjectName).replace("SERIES_PLACEHOLDER", stringifiedSeries).replace("XAXISCATEGORIES_PLACEHOLDERS", JSON.stringify(xAxisLabels));
            allChartsHtml = allChartsHtml + chartHtml;
        }
    }
    
    return htmlReportTemplate.replace("CHARTPLACEHOLDER", allChartsHtml).replace("PIPELINENAMEPLACEHOLDER", pipelineName).replace("COMPARISONNAMEPLACEHOLDER", comparisonName);
}
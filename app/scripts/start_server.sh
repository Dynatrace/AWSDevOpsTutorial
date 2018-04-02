#!/bin/bash
# We start off with setting build number information - this allows us to control which version of our code we actually run. In our demo env this is the only thing we need to change to "simulate a new build"
export BUILD_NUMBER=1

# Now we set our Dyntrace environment variables that get passed to the Node.js processes. Dynatrace OneAgent will automatically add these variables as Process Group Instance properties
export DT_TAGS=APPLICATION_NAME=$APPLICATION_NAME
export DT_CUSTOM_PROP="DEPLOYMENT_ID=$DEPLOYMENT_ID DEPLOYMENT_GROUP_NAME=$DEPLOYMENT_GROUP_NAME APPLICATION_NAME=$APPLICATION_NAME"
export DT_CLUSTER_ID="$DEPLOYMENT_GROUP_NAME $APPLICATION_NAME"

# now we launch our app
cd /home/ec2-user
pm2 start app.js &> pm2start.log
echo "Deploying DEPLOYMENT_ID=$DEPLOYMENT_ID DEPLOYMENT_GROUP_NAME=$DEPLOYMENT_GROUP_NAME APPLICATION_NAME=$APPLICATION_NAME"

# now lets make sure the app is really up & running - execute a couple of requests using the x-dynatrace header to identify these requests in Dynatrace as startup tests
sleep 5;
echo "Running a simply set of curls to validate the service is up and running"
curl -s "http://localhost/" -H "x-dynatrace: NA=StartUp.Homepage;" -o nul &> startuptest.log
curl -s "http://localhost/version" -H "x-dynatrace: NA=StartUp.Version;" -o nul &> startuptest.log
curl -s "http://localhost/api/echo?text=This is from a testing script" -H "x-dynatrace: NA=StartUp.Echo;" -o nul &> startuptest.log
curl -s "http://localhost/api/invoke?url=http://www.dynatrace.com" -H "x-dynatrace: NA=StartUp.Invoke;" -o nul &> startuptest.log
sleep 5;
exit 0
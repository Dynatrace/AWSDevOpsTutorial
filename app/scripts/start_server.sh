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
exit 0
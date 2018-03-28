#!/bin/bash
echo "Load Test Launched in Deployment Group $DEPLOYMENT_GROUP"  >> ./loadtest.log
while [ ! -f ./endloadtest.txt ];
do
  # In Production we sleep less which means we will have more load
  # In Testing we also add the x-dynatrace HTTP Header so that we can demo our "load testing integration" options using Request Attributes!
  if [[ $DEPLOYMENT_GROUP == *"Production"* ]]; then
    curl -s "http://localhost/" -o nul &> loadtest.log
    curl -s "http://localhost/version" -o nul &> loadtest.log
    curl -s "http://localhost/api/echo?text=This is from a production user" -o nul &> loadtest.log
    curl -s "http://localhost/api/invoke?url=http://www.dynatrace.com" -o nul &> loadtest.log
    curl -s "http://localhost/api/invoke?url=http://blog.dynatrace.com" -o nul &> loadtest.log

    sleep 2;
  else 
    curl -s "http://localhost/" -H "x-dynatrace: NA=Test.Homepage;" -o nul &> loadtest.log
    curl -s "http://localhost/version" -H "x-dynatrace: NA=Test.Version;" -o nul &> loadtest.log
    curl -s "http://localhost/api/echo?text=This is from a testing script" -H "x-dynatrace: NA=Test.Echo;" -o nul &> loadtest.log
    curl -s "http://localhost/api/invoke?url=http://www.dynatrace.com" -H "x-dynatrace: NA=Test.Invoke;" -o nul &> loadtest.log

    sleep 5;
  fi
done;
exit 0
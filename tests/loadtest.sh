#!/bin/bash
echo "Load Test Launched in Deployment Group $DEPLOYMENT_GROUP"  >> ./loadtest.log
while [ ! -f ./endloadtest.txt ];
do
  curl -s "http://localhost/" -o nul &> loadtest.log
  curl -s "http://localhost/version" -o nul &> loadtest.log
  curl -s "http://localhost/api/echo?text=This is from a testing script" -o nul &> loadtest.log
  curl -s "http://localhost/api/invoke?url=http://www.dynatrace.com" -o nul &> loadtest.log

  # In Production we sleep less which means we will have more load
  if [[ $DEPLOYMENT_GROUP == *"Production"* ]]; then
    sleep 2;
  else 
    sleep 5;
  fi
done;
exit 0
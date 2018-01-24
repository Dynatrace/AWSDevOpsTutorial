#!/bin/bash
cd /home/ec2-user
rm -f ./loadtestinit.sh
echo "#!/bin/bash" >> loadtestinit.sh
echo "export DEPLOYMENT_GROUP=$DEPLOYMENT_GROUP_NAME" >> loadtestinit.sh;
echo "./loadtest.sh" >> loadtestinit.sh
chmod 777 loadtestinit.sh

rm -f ./endloadtest.txt &> loadtest.log
nohup ./loadtestinit.sh >/dev/null 2>&1 &
exit 0
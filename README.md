# AWSDevOpsTutorial
Unbreakable DevOps Pipeline Tutorial with AWS CodeDeploy, AWS CodePipeline, AWS Lambda, EC2 and Dynatrace.

The goal of this tutorial is having a full end-to-end AWS DevOps Pipeline (Staging, Approval, Production) that is fully monitored with Dynatrace. With Dynatrace injected into the pipeline you get the following features
1. Monitor your Staging Environment
2. Automate Approve/Reject Promotion from Staging to Production based on Performance Data
3. Monitor your Production Environment
4. Automatic Deploy of previous revision in case Dynatrace detected problems in Production

Before we launch the CloudFormation stack which will create all required resources (EC2 Instances, Lambdas, CodeDeploy, CodePipeline, API Gateway) lets make sure we have all pre-requisits covered!

## Pre-Requisits
1. You need an AWS account. If you dont have one [get one here](https://aws.amazon.com/)
2. You need a Dynatrace Account. Get your [Free SaaS Trial here!](http://bit.ly/dtsaastrial)
3. You need to clone or copy the content of this GitHub repo to your local disk!

## Preparation
**Amazon**
As we are going to use AWS CodeDeploy, AWS CodePipeline, AWS Lambda, DynamoDB, API Gateway and EC2 make sure the AWS Region you select provides all these services. We have tested this cloud formation on US-West-2a (Oregon) and US-East-2b (Ohio). To be on the safe side we suggest you pick one of these regions!

1. Create an EC2 Key Pair for your AWS Region! Our CloudFormation Template needs an EC2 Key Pair!
1.1. To learn more about Key Pairs and how to connect to EC2 Instances for troubleshooting read [Connect to your Linux Instance](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/AccessingInstances.html)
2. Create a S3 Bucket with the naming scheme: <yourname>-dynatracedevops and enable versioning. See following screenshots for reference
![](./images/preparation_creates3bucket.png)
3. Copy the content from the folder "copytos3" to your newly created S3 bucket. This includes the application package, tests, monspec as well as all Lambda functions
![](./images/preparation_copytos3.png)

**Dynatrace**
We need a couple of things to launch the CloudFormation Template
1. Your *Dynatrace Tenant URL*: For SaaS that would be something like http://<yourtenant>.live.dynatrace.com. For Managed it would be http://<yourserver>/e/<your-env-id>
2. Your *Dynatrace OneAgent for Linux Download URL*: Go to Deploy Dynatrace -> Start Installation -> Linux and copy the URL within the quotes as shown below:
![](./images/preparation_dynatraceoneagenturl.png)
3. A *Dynatrace API Token*: Go to Settings -> Integration -> Dynatrace API and create a new Token
![](./images/preparation_dynatraceapitoken.png)

## Lets create the CloudFormation Stack
You can download the stack definition from [here](./AWSDevOpsTutorialCloudFormationStack.json) - or simply click on one of the following links which will directly get you to the CloudFormation Wizard for the respective region.

Region | Launch Template
------------ | -------------
**N. Virginia** (us-east-1) | [![Launch Dynatrace DevOps Stack into Virginia with CloudFormation](/Images/deploy-to-aws.png)](https://console.aws.amazon.com/cloudformation/home?region=us-east-1#/stacks/new?stackName=dynatracedevopsstack&templateURL=https://github.com/Dynatrace/AWSDevOpsTutorial/AWSDevOpsTutorialCloudFormationStack.json)
**Ohio** (us-east-2) | [![Launch Dynatrace DevOps Stack into Ohio with CloudFormation](/Images/deploy-to-aws.png)](https://console.aws.amazon.com/cloudformation/home?region=us-east-2#/stacks/new?stackName=dynatracedevopsstack&templateURL=https://github.com/Dynatrace/AWSDevOpsTutorial/AWSDevOpsTutorialCloudFormationStack.jsonn)
**Oregon** (us-west-2) | [![Launch Dynatrace DevOps Stack into Oregon with CloudFormation](/Images/deploy-to-aws.png)](https://console.aws.amazon.com/cloudformation/home?region=us-west-2#/stacks/new?stackName=dynatracedevopsstack&templateURL=https://github.com/Dynatrace/AWSDevOpsTutorial/AWSDevOpsTutorialCloudFormationStack.json)
**Ireland** (eu-west-1) | [![Launch Dynatrace DevOps Stack into Ireland with CloudFormation](/Images/deploy-to-aws.png)](https://console.aws.amazon.com/cloudformation/home?region=eu-west-1#/stacks/new?stackName=dynatracedevopsstack&templateURL=https://github.com/Dynatrace/AWSDevOpsTutorial/AWSDevOpsTutorialCloudFormationStack.json)
**Frankfurt** (eu-central-1) | [![Launch Dynatrace DevOps Stack into Frankfurt with CloudFormation](/Images/deploy-to-aws.png)](https://console.aws.amazon.com/cloudformation/home?region=eu-central-1#/stacks/new?stackName=dynatracedevopsstack&templateURL=https://github.com/Dynatrace/AWSDevOpsTutorial/AWSDevOpsTutorialCloudFormationStack.json)
**Tokyo** (ap-northeast-1) | [![Launch Dynatrace DevOps Stack into Tokyo with CloudFormation](/Images/deploy-to-aws.png)](https://console.aws.amazon.com/cloudformation/home?region=ap-northeast-1#/stacks/new?stackName=dynatracedevopsstack&templateURL=https://github.com/Dynatrace/AWSDevOpsTutorial/AWSDevOpsTutorialCloudFormationStack.json)
**Seoul** (ap-northeast-2) | [![Launch Dynatrace DevOps Stack into Seoul with CloudFormation](/Images/deploy-to-aws.png)](https://console.aws.amazon.com/cloudformation/home?region=ap-northeast-2#/stacks/new?stackName=dynatracedevopsstack&templateURL=https://github.com/Dynatrace/AWSDevOpsTutorial/AWSDevOpsTutorialCloudFormationStack.json)
**Singapore** (ap-southeast-1) | [![Launch Dynatrace DevOps Stack into Singapore with CloudFormation](/Images/deploy-to-aws.png)](https://console.aws.amazon.com/cloudformation/home?region=ap-southeast-1#/stacks/new?stackName=dynatracedevopsstack&templateURL=https://github.com/Dynatrace/AWSDevOpsTutorial/AWSDevOpsTutorialCloudFormationStack.json)
**Sydney** (ap-southeast-2) | [![Launch Dynatrace DevOps Stack into Sydney with CloudFormation](/Images/deploy-to-aws.png)](https://console.aws.amazon.com/cloudformation/home?region=ap-southeast-2#/stacks/new?stackName=dynatracedevopsstack&templateURL=https://github.com/Dynatrace/AWSDevOpsTutorial/AWSDevOpsTutorialCloudFormationStack.json)


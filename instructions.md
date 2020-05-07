# firerun-extension

fireRun.io Firebase Extension to track Firebase usage and costs

## Guide

[Extension Guide](https://firebase.google.com/docs/extensions/alpha/overview-build-extensions)

1. Install firebase: `npm install -g firebase-tools`
2. Enable extension: `firebase --open-sesame extdev`

If you want to create a test 'greet world' extension, use `firebase ext:dev:init`. Not necessary for this code to run.

## Install Locally

`git clone https://github.com/fireRun-io/firerun-ext`

## Run Locally

**Note:** will fail since schedule can not run locally, but good to be sure compiled. Also, by using the test-params.env, you won't be asked to enter your email or Access Token.

1. cd firerun-extension
2. cd functions
3. Install the modules with `npm install`
4. Run the emulator: `firebase ext:dev:emulators:start --test-params=test-params.env --project=[projectId]`

**Note:** Please create a .env file with params for EMAIL, TOKEN, and ROLLBAR

Example: `firebase ext:dev:emulators:start --test-params=test-params.env --project=firerun`

## Install Production

1. cd firerun-extension
2. cd functions
3. `firebase ext:install . --project=[projectId]`
4. Enter your email and your Access Token, which is your UID (can get from the Firebase console Authentication section)

Example: `firebase ext:install . --project=firerun`

or

1. Install via tarball: `firebase ext:install https://firebasestorage.googleapis.com/v0/b/firerun-extensions/o/daily-report%2Ffirerun-extension-0.1.tar.gz?alt=media&token=a94e56ff-9d0f-4440-923e-72984761ec2c --project=firerun`

## Notes

1. If you want to make changes, uninstall the extension in the Firebase console
2. Be sure functions gone in the [Google Console](https://console.cloud.google.com/functions/list?project=firerun)
3. To change the frequency of the run, in the extension.yaml file, change `schedule:` under `scheduleTrigger:` to a [google cron syntax](https://cloud.google.com/appengine/docs/standard/python/config/cronref). For example: if want to run every hour `schedule: every 1 hour`

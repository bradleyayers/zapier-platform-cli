const colors = require('colors/safe');

const constants = require('../constants');

const qs = require('querystring');

const AdmZip = require('adm-zip');
const fetch = require('node-fetch');
const path = require('path');

const {
  writeFile,
  readFile,
} = require('./files');

const {
  prettyJSONstringify,
  printStarting,
  printDone,
} = require('./display');


// Reads the JSON file at ~/.zapier-platform (AUTH_LOCATION).
const readCredentials = (credentials) => {
  return Promise.resolve(
    credentials ||
    readFile(constants.AUTH_LOCATION, 'Please run `zapier auth`.')
      .then((buf) => {
        return JSON.parse(buf.toString());
      })
  );
};

// Calls the underlying platform REST API with proper authentication.
const callAPI = (route, options) => {
  options = options || {};
  var requestOptions;
  return readCredentials()
    .then((credentials) => {
      requestOptions = {
        method: options.method || 'GET',
        url: constants.ENDPOINT + route,
        body: options.body ? JSON.stringify(options.body) : null,
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json; charset=utf-8',
          'X-Requested-With': 'XMLHttpRequest',
          'X-Deploy-Key': credentials.deployKey
        }
      };
      return fetch(requestOptions.url, requestOptions);
    })
    .then((res) => {
      return Promise.all([
        res,
        res.text()
      ]);
    })
    .then(([res, text]) => {
      let errors;
      const hitError = res.status >= 400;
      if (hitError) {
        try {
          errors = JSON.parse(text).errors.join(', ');
        } catch(err) {
          errors = (text || 'Unknown error').slice(0, 250);
        }
      }

      if (constants.DEBUG || global.argOpts.debug) {
        console.log(`>> ${requestOptions.method} ${requestOptions.url}`);
        if (requestOptions.body) { console.log(`>> ${requestOptions.body}`); }
        console.log(`<< ${res.status}`);
        console.log(`<< ${(text || '').substring(0, 2500)}\n`);
      } else if (hitError) {
        printDone(false);
        console.log('');
        console.log('  ' + colors.red(errors));
      }

      if (hitError) {
        throw new Error(`"${requestOptions.url}" returned "${res.status}" saying "${errors}"`);
      }

      return JSON.parse(text);
    });
};

// Reads the JSON file at ~/.zapier-platform (AUTH_LOCATION).
const getLinkedAppConfig = (appDir) => {
  appDir = appDir || '.';

  const file = path.resolve(appDir, constants.CURRENT_APP_FILE);
  return readFile(file)
    .then((buf) => {
      return JSON.parse(buf.toString()).id;
    });
};

const writeLinkedAppConfig = (app, appDir) => {
  const file = appDir ?
        path.resolve(appDir, constants.CURRENT_APP_FILE) :
        constants.CURRENT_APP_FILE;

  return writeFile(file, prettyJSONstringify({
    id: app.id,
    key: app.key
  }));
};

// Loads the linked app from the API.
const getLinkedApp = (appDir) => {
  return getLinkedAppConfig(appDir)
    .then((appId) => {
      if (!appId) {
        return {};
      }
      return callAPI('/apps/' + appId);
    })
    .catch(() => {
      throw new Error(`Warning! ${constants.CURRENT_APP_FILE} seems to be incorrect. Try running \`zapier link\` or \`zapier create\`.`);
    });
};

const checkCredentials = () => {
  return callAPI('/check');
};

const listApps = () => {
  return checkCredentials()
    .then(() => {
      return Promise.all([
        getLinkedApp()
          .catch(() => {
            return undefined;
          }),
        callAPI('/apps')
      ]);
    })
    .then((values) => {
      var [linkedApp, data] = values;
      return {
        app: linkedApp,
        apps: data.objects.map((app) => {
          app.linked = (linkedApp && app.id === linkedApp.id) ? '✔' : '';
          return app;
        })
      };
    });
};

const listEndoint = (endpoint, keyOverride) => {
  return checkCredentials()
    .then(getLinkedApp)
    .then((app) => {
      return Promise.all([
        app,
        callAPI(`/apps/${app.id}/${endpoint}`)
      ]);
    })
    .then(([app, results]) => {
      var out = {
        app: app
      };
      out[keyOverride || endpoint] = results.objects;
      return out;
    });
};

const listVersions = () => {
  return listEndoint('versions');
};

const listHistory = () => {
  return listEndoint('history');
};

const listInvitees = () => {
  return listEndoint('invitees');
};

const listLogs = (opts) => {
  return listEndoint(`logs?${qs.stringify(opts)}`, 'logs');
};

const listEnv = (version) => {
  var endpoint;
  if (version) {
    endpoint = `versions/${version}/environment`;
  } else {
    endpoint = 'environment';
  }
  return listEndoint(endpoint, 'environment');
};

const upload = (zipPath, appDir) => {
  zipPath = zipPath || constants.BUILD_PATH;
  const fullZipPath = path.resolve(appDir, zipPath);

  return getLinkedApp(appDir)
    .then((app) => {
      var zip = new AdmZip(fullZipPath);
      var definitionJson = zip.readAsText('definition.json');
      if (!definitionJson) {
        throw new Error('definition.json in the zip was missing!');
      }
      var definition = JSON.parse(definitionJson);

      printStarting('Uploading version ' + definition.version);
      return callAPI(`/apps/${app.id}/versions/${definition.version}`, {
        method: 'PUT',
        body: {
          zip_file: zip.toBuffer().toString('base64')
        }
      });
    })
    .then(() => {
      printDone();
    });
};

module.exports = {
  readCredentials,
  callAPI,
  writeLinkedAppConfig,
  getLinkedApp,
  checkCredentials,
  listApps,
  listEndoint,
  listVersions,
  listHistory,
  listInvitees,
  listLogs,
  listEnv,
  upload,
};

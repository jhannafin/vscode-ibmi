import dns from "dns/promises";
import querystring from "querystring";
import vscode, { l10n } from "vscode";
import IBMi from "../../api/IBMi";
import { ConnectionData, DefaultOpenMode, WithPath } from "../../typings";
import { Code4iUriHandler } from "../handler";

type Parameters = {
  path: WithPath
  readonly?: DefaultOpenMode
  host?: ConnectionData
  connect?: boolean
  cancel?: boolean
}

/**
 * Handles /open with the following query parameters: 
 *  - `path`: an IFS path; supports /QSYS.LIB paths to open members
 *  - `host` (optional): the IBM i host to connect to; can be a host name, an IP or a server configuration name use current connection if not specified
 *  - `readonly`: if specified, the member/file will be opened in read-only mode
 * 
 * Examples:
 * - /open?path=/tmp/test.txt
 * - /open?path=/tmp/dontchange.txt&readonly
 * - /open?host=PUB400.com&path=/tmp/dontchange.txt&readonly
 */
export const openURIHandler: Code4iUriHandler = {
  canHandle: (path) => path === `/open`,
  async handle(uri, connection) {
    try {
      const parameters = await loadParameters(querystring.parse(uri.query), connection);
      if (!parameters.cancel) {
        if (parameters.connect && parameters.host) {
          await vscode.commands.executeCommand(`code-for-ibmi.connectTo`, parameters.host.name)
        }        

        vscode.commands.executeCommand("code-for-ibmi.openWithDefaultMode", parameters.path, parameters.readonly);
      }
    }
    catch (error: any) {
      let message;
      if (error.code === "ENOTFOUND") {
        message = l10n.t("Could not resolve hostname {0}", error.hostname);
      }
      else if (error instanceof Error) {
        message = error.message;
      }
      else if (typeof error === "string") {
        message = error;
      }
      else {
        message = String(error);
      }
      vscode.window.showErrorMessage(message);
    }
  }
}

function toBoolean(value?: string) {
  return value !== undefined && (value === "" || value.toLowerCase() === "true");
}

async function loadParameters(query: querystring.ParsedUrlQuery, connection?: IBMi): Promise<Parameters> {
  const path = toPath(query.path as string | undefined);
  const readonly: DefaultOpenMode | undefined = toBoolean(query.readonly as string | undefined) ? "browse" : undefined;
  const host = await resolveHost(query.host as string | undefined);
  let connect;
  let cancel;

  if (!connection && !host) {
    throw l10n.t("Not connected to IBM i: 'host' query parameter is required");
  }

  if (connection && host) {
    if (host.name !== connection.currentConnectionName) {
      if (await vscode.window.showWarningMessage(l10n.t("You're currently connected to {0}. Do you want to disconnect and switch to {1}?", connection.currentHost, host.name), { modal: true }, l10n.t("Connect to {0}", host.name))) {
        connect = true;
      }
      else {
        cancel = true;
      }
    }
  }
  else if (host) {
    connect = true;
  }

  return { path, readonly, host, connect, cancel };
}

/**
 * Search for `host` in the configured connections, by name, and then by IP.
 * 
 * @param host a host address or IP
 * @returns the corresponding {@link ConnectionData}
 * @throws an `Error` if DNS lookup fails or if no configuration matches this host
 */
async function resolveHost(host?: string) {
  if (host) {
    const connectionByName = IBMi.connectionManager.getByName(host)?.data;
    if (connectionByName) {
      return connectionByName;
    }

    const ip = !/^((25[0-5]|(2[0-4]|1\d|[1-9]|)\d)\.?\b){4}$/.test(host) ? (await dns.lookup(host)).address : host;
    for (const connection of IBMi.connectionManager.getAll()) {
      if ((await dns.lookup(connection.host)).address === ip) {
        return connection;
      }
    }

    throw new Error(l10n.t("No connection matches name or host {0} ({1})", host, ip));
  }
}

function toPath(path?: string): WithPath {
  if (!path) {
    throw l10n.t("'path' query parameter is required");
  }

  return { path };
}
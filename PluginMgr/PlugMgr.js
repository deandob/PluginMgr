// NODE Plugin Manager to load and manage HA plugins
"use strict";


var fs = require("fs");
var path = require("path");
var http = require("http");
var url = require("url");
var ini = require("ini");                       // https://github.com/isaacs/ini
var fork = require('child_process').fork;
global._serverName = require("os").hostname();
var started = false
var iniMsgs = []
var categories;
var func = {
        action: 0,                                              // Action or method call
        response: 1,                                            // Data response to a method call
        event: 2,                                               // Asynchronous event message
        log: 3,                                                 // Log Message
        error: 4,                                               // Error Message
        sql: 5                                                  // Execute SQL message
}

status("SYSTEM/PLUGINS", "Starting plugin server...");
//////////////////////// Global functions
global._network = function getNetwork() {
    return 1;
}

var plugins = [];
var plugin = function (category, className, desc, status, channels, recvFunc, enabled, genSettings, store, catDir) {
    this.category = category;
    this.className = className
    this.type = "NODEJS"
    this.desc = desc;
    this.status = status;
    this.channels = channels;
    this.recvFunc = recvFunc;
    this.enabled = enabled;
    this.genSettings = genSettings;
    this.store = store;
    this.catDir = catDir;
    this.lastMsg = {instance: "", scope: "", data: ""};
}

var channel = function (name, desc, type, io, min, max, units, attribs) {
    this.name = name
    this.desc = desc;
    this.type = type;
    this.io = io;
    this.min = min;
    this.max = max;
    this.units = units;
    this.attribs = attribs;
    this.value = null;
}

var chAttrib = function (name, type, value) {
    this.name = name;
    this.type = type;
    this.value = value;
}

process.on("uncaughtException", function(err) {
    console.dir("Caught an unhandled exception: " + err + " " + err.stack);
});

/////////////////////////// Plugins
// Load plugins

var debugPort = 5858;
var startOpts = {};
var isInDebugMode = typeof v8debug === 'object';

var pluginDir = "plugins";          //TODO: Put into INI file
function loadPlugins() {
    try {
        for (var catNum in categories) {                                                                        // loop through all categories
            var catDir = path.join(pluginDir, categories[catNum].Cat);
            if (fs.existsSync(catDir)) {
                var pluginFiles = fs.readdirSync(catDir);
                for (var plugNum in pluginFiles) {
                                                              // Loop through files in category directory
                    var pluginFile = pluginFiles[plugNum];
                    
                    if (pluginFile.substr(pluginFile.length - 3) === ".js") {                        // look for javascript files                        
                        var pluginName = pluginFile.replace(".js", "");
                        var channels = [];
                        try {
                            var iniFile = path.join("plugins", categories[catNum].Cat, pluginName + ".ini");             // get plugin configuration from ini file
                            if (fs.existsSync(iniFile)) {
                                var myFile = fs.readFileSync(iniFile, "utf-8")
                                var myIni = ini.parse(myFile)
                                var iniCfg = toLowerKey(myIni)
                                if (iniCfg.desc === undefined)                                                         // TODO: BUG IN INI ROUTINE, SOMETIMES RETURNS FIRST SECTION AS TRUE NOT AN ARRAY
                                {
                                    iniCfg.desc = toLowerKey(iniCfg.plugincfg).desc
                                    iniCfg.enabled = toLowerKey(iniCfg.plugincfg).enabled
                                }
                                var genSettings = toLowerKey(iniCfg.general)
                                var store = toLowerKey(iniCfg.store)
                                
                                // extract channel info
                                for (var chNum = 0; true; chNum++) {
                                    var ch = toLowerKey(iniCfg["channel" + chNum]);                                      // make keys lower case
                                    if (ch === undefined) break;                                                        // loop until no more channels are found
                                    var attribs = [];
                                    for (var attribNum = 0; true; attribNum++) {
                                        var attrib = toLowerKey(iniCfg["channel" + chNum]["attrib" + attribNum]);        // attribs found in section [channel#.attrib#]
                                        if (attrib === undefined) break;                                                // loop extracting all channel attribute info
                                        attribs.push(new chAttrib(attrib.name, attrib.type.toUpperCase(), attrib.value));
                                    }
                                    channels.push(new channel(ch.name, ch.desc, ch.type, ch.io, ch.min, ch.max, ch.units, attribs));
                                }
                            }
                            if (iniCfg.enabled === true) startPlugin(new plugin(categories[catNum].Cat.toUpperCase(), pluginName, iniCfg.desc, "LOADED", channels, "", iniCfg.enabled, genSettings, store, catDir))
                        } catch (e) {
                            status("SYSTEM/PLUGINS", "Plugin load error in '" + pluginName + "'. Plugin will be disabled. Error: " + plugStatus);
                            killChild(plugins.length - 1);                        }
                    } 
                }
            }
        }
        var stripRef = [];
        for (var plug in plugins) stripRef.push(new plugin(plugins[plug].category, plugins[plug].className, plugins[plug].desc, plugins[plug].status, plugins[plug].channels, "", plugins[plug].enabled));
        actionSend("SYSTEM", "NETWORK", "PLUGINS", "INIT", JSON.stringify(stripRef))
        started = true                                                              // enable sending host messages & send any messages sent during plugin startup but before plugin was registered
        for (var lp = 0; lp < iniMsgs.length; lp++) {
            toHost("tohost", iniMsgs[lp].cat, iniMsgs[lp].name, iniMsgs[lp].channel, iniMsgs[lp].scope, iniMsgs[lp].data);
        }
    } catch (e) {
        status("SYSTEM/PLUGINS", "ERROR: Plugin loading error, plugins may be unstable... " + e.stack);        
    }
}

// Add plugin and start
function startPlugin(plug) {
    try {
        status("SYSTEM/PLUGINS", "Starting child plugin " + plug.className + "...");
        debugPort = debugPort + 1;
        if (isInDebugMode) startOpts = { execArgv: ['--debug=' + debugPort] };
        plugins.push(plug);        // loaded OK so save plugin cfg (if no config found most of plugincfg is undefined but still valid)
        plugins[plugins.length - 1].recvFunc = fork("./" + path.join(plug.catDir, plug.className + ".js"), [], startOpts);                       // Create child process (13M per plugin) for isolation        
        plugins[plugins.length - 1].recvFunc.on('message', function (msg) { toHost(msg.func, msg.cat, msg.name, msg.channel, msg.scope, msg.data, msg.log); });
        plugins[plugins.length - 1].recvFunc.on('exit', function (code, signal) { childEnded("exit", this.pid, code, signal); });
        if (plugins[plugins.length - 1].recvFunc.send({ func: "init", data: { cat: plug.category, name: plug.className, channels: plug.channels, settings: plug.genSettings, store: plug.store } }) === false) { // start plugin & pass in config info
            status("SYSTEM/PLUGINS", "Can't communicate with child plugin '" + plug.className + "'. Plugin will be disabled.");
            killChild(plugins.length - 1);
        };
    } catch (e) {
        status("SYSTEM/PLUGINS", "Plugin startup error in '" + plug.className + "'. Plugin will be disabled. Error: " + e.stack);
        killChild(plugins.length - 1);
    }

}

// Handle child plugin when ending abnormally
function childEnded(func, pid, param0, param1) {
    var pluginName;    
    for (var plug in plugins) {                                 // Look for plugin pid in plugins array
        if (plugins[plug].recvFunc.pid === pid) {
            pluginName = plugins[plug].className
            break;
        }
    }
    if (pluginName !== null) {
        setTimeout(startPlugin, 3000, plugins.splice(plug, 1)[0])            // remove from plugin array and try again
    }
    status("SYSTEM/PLUGINS", "ERROR: Plugin " + pluginName + " ended as '" + func + "' code: " + param0 + " signal: " + param1 + ". Restarting...");
}

// Kill the child process when in error
function killChild(num) {
    plugins[num].recvFunc.kill();
    plugins.splice(num, 1);
}

function loadIniArrays(fileLoc) {
    //TODO
}

function sessionStarted() {
    status("SYSTEM/PLUGINS", "Plugins ready.")
}
    
// Shut down the plugins in an orderly fashion
function shutPlugins() {
    for (var plug in plugins) {
        plugins[plug].shutPlugin()
    }     
}

//////////////////////////////////////// Exports
// plugins call to send host messages
function toHost(func, cat, name, channel, scope, data, log) {
    //TODO: Dont accept messages from plugins that didnt start properly
    switch (func) {
        case "init":
            var portStr = "";
            if (log !== undefined) portStr = ", debugging on port: " + log.split("debug=")[1];
            status(cat.toUpperCase() + "/" + name.toUpperCase(), "Plugin loaded and started with status: " + data + portStr);
            //TODO: If data != OK, kill the plugin            
            break;
        case "tohost":
            if (started === false) {
                // save for future send any ini messages sent during startup until the plugins have all been registered
                iniMsgs.push({ "cat": cat, "name": name, "channel": channel, "scope": scope, "data": data, "log": log });
                return;
            } else {
                return eventSend(cat, name, channel, scope, data, log);
            }
            break;
        case "restart":
            restart(data);
            break;
        case "log":
            writeLog(cat.toUpperCase() + "/" + name.toUpperCase(), log);
            break;
        case "addch":
            addChannel(cat, name, channel, scope, data.type, data.io, data.min, data.max, data.units, data.attribs, data.value, data.store);
            break;
        case "writeini":
            writeIni(cat, name, data.section, data.subSection, data.key, data.value);
            break;
    }    
}

// Dynamically add channel 
function addChannel(cat, plugName, name, desc, type, io, min, max, units, attribs, value, store) {
    for (var myPlug in plugins) {
        if (plugins[myPlug].category.toUpperCase() === cat.toUpperCase() && plugins[myPlug].className.toUpperCase() === plugName.toUpperCase()) {
            if (attribs === undefined) var attribs = []
            var newCh = new channel(name, desc, type, io, min, max, units, attribs)
            plugins[myPlug].channels.push(newCh)
            actionSend(cat, plugName, "", "ADDCH", JSON.stringify(newCh))
            break;
        }
    }
}

// failure of the plugin, request restart (all plugins restarted)
function restart(code) {
    //TODO: Only the plugin
    status("SYSTEM/PLUGINS", "Restart request. Error code: " + code);
    process.exit(code);            // >0 causes restart
}

// display on the console or log
function writeLog(caller, msg) {
    status(caller, msg);
}

// Update a plugin INI file
function writeIni(category, className, section, subSection, key, value) {
    try {
        var iniLoc = path.join("plugins", category, className + ".ini");
        if (fs.existsSync(iniLoc)) {                                                                        // get files in all category directories
            var oldIni = ini.parse(fs.readFileSync(iniLoc, "utf-8"));
            if (subSection === "") {
                oldIni[section][key] = value;                                        // BUG: Will crash with the "true" bug in the ini module (section not setup as an array). Don't try to modify the [PluginMgr] section
            } else {
                oldIni[section][subSection][key] = value;
            }
            var newIni = ini.stringify(oldIni);
            //TODO: Work out why this ini routine has trouble with quotes and making the first section entry like this: "[xyz]" = true. The 2 lines below are temporary workarounds
            // ini routine trys to make the value "safe" by making a value a JSDON string if it sees a "[" in the value field. Is this a bug?????
            newIni = newIni.replace(/\\\"/g,"\"").replace("\"[", "[").replace("]\"", "]");       // Another INI bug where if the value has a string quote inside it, it wraps the whole value in a string and escapes the original quote. Eg. [{"x1":0.21}] becomes "[{\"x1\":0.21}]" when stringified
            newIni = newIni.replace("\"[", "[").replace("]\" = true", "]");       // Bug in ini module puts quotes around initial section brackets and " = true" as this is how the root section is represented in the object. Not consistent, maybe somethign to do with the line breaks?
            fs.writeFile(iniLoc, newIni, "utf-8");
            loadIniArrays(iniLoc);                                               // Modify the in memory arrays
        }
    } catch (e) {
        //TODO:
    }
}

// Process messages from HA engine
function pluginMsg(msg) {
    for (var plugNum in plugins) {
        if (plugins[plugNum].className.toUpperCase() === msg.ClassName.toUpperCase()) {
            if (plugins[plugNum].category.toUpperCase() === msg.Category.toUpperCase()) {
                if (plugins[plugNum].lastMsg.instance !== msg.Instance || plugins[plugNum].lastMsg.scope !== msg.Scope || plugins[plugNum].lastMsg.data !== msg.Data) {  // Don't echo message just sent to the same plugin
                    try {
                        return plugins[plugNum].recvFunc.send({ func: "fromhost", channel: msg.Instance, scope: msg.Scope, data: msg.Data });
                    } catch (e) {
                        status("SYSTEM/NETWORK", "ERROR: Can't send message (" + msg.ClassName + "/" + msg.Instance + " " + msg.Data + ") to plugin. Error: " + e)
                    }
                }                    
            }
        }
    }
}

/////////////////////////// Web Server
webSvr();
function webSvr() {
    var express = require('express');
    var compression = require('compression')
    var app = express();
    var __dirname = ""
    status("SYSTEM/HTTP", "NODE.JS settings: " + app.get('env'));                 // affects cache, needs NODE_ENV environment variable set to production
    app.use(compression({ threshold: 512 }));
    var oneYear = 86400000 * 365;
    app.enable('etag')
    app.use(express.static(__dirname + '../../HAWebClient', { maxAge: oneYear }));
    app.use(function (err, req, res, next) {
        if (!err) return next();
        status("SYSTEM/HTTP", "Error with processing HTTP request: " + req + " Error: " + err);
        res.send(500, JSON.stringify(err, ['stack', 'message']));
    });
    var appSvr = app.listen(80);
    appSvr.on("error", function (err) {
        status("SYSTEM/HTTP", "Error with the web server " + err);
    });
    appSvr.on("close", function () {
        setTimeout(function () {
            status("SYSTEM/HTTP", "Web Server closed. Restarting...");
            appSvr = app.listen(80);
        }, 1000);
    });
    status("SYSTEM/HTTP", "HTTP server started.")
}

/////////////////////////// Socket Client
// Format http://server/category/class/instance?scope=xxx?data=yyyy
// Client cmd: powershell Invoke-WebRequest -URI http://192.168.1.20/Lighting/CBUS/Mastbed%20Julie%20WIR?scope=action?data=100
//socketCli();

function socketCli() {
    var client = require('net').connect(9764, "192.168.1.14", function() {
        status("SYSTEM/SOCKETS",'Sockets client connected');
        });
    client.on('data', function(data) {
        //status("SYSTEM/SOCKETS","------------------> from PIC: " + data.toString());
        client.end();
   });
    client.on('end', function() {
        status("SYSTEM/SOCKETS","Sockets client disconnected");
    });
    client.on('error', function () {
        status("SYSTEM/SOCKETS","Sockets can't connect to client");
    });
//    //var socket = require('socket.io').
}

/////////////////////////// Socket Server

socketSvr();
function socketSvr() {
    var server = require('net').createServer(function (sock) { //'connection' listener
        status("SYSTEM/SOCKETS","Sockets client connected " + sock.remoteAddress);
        sock.on('end', function () {
            status("SYSTEM/SOCKETS",'Sockets client disconnected');
        }); 
        sock.on('data', function (data) {
            status("SYSTEM/SOCKETS",'Sockets client data: ' + data.toString());
        });
        sock.on('error', function (err) {
            status("SYSTEM/SOCKETS",'Sockets error from Client: ' + err);
        });
    });
    var sockSvr = server.listen(8124, "homeserver.home", function () {
        status("SYSTEM/SOCKETS","Sockets Server listening on " + server.address().address + ':' + server.address().port);
    });
    sockSvr.on("error", function (err) {
        status("SYSTEM/SOCKETS", "Error with the Sockets server " + err);
    });
    sockSvr.on("close", function () {
        setTimeout(function () {
            status("SYSTEM/SOCKETS", "Sockets Server closed. Restarting...");
            sockSvr = server.listen(8124, "homeserver.home", function () {
                status("SYSTEM/SOCKETS", "Sockets Server listening on " + server.address().address + ':' + server.address().port);
            });
        }, 1000);
    });
}

/////////////////////////// REST API Server
// Format http://server/category/class/instance?scope=xxx?data=yyyy
// Client cmd: powershell Invoke-WebRequest -URI http://192.168.1.20/Lighting/CBUS/Mastbed%20Julie%20WIR?scope=action?data=100
APISvr();

function APISvr() {
    var httpAPI = function (req, resp) {
        var HAMsg = function (cat, className, channel, scope, data) {
            this.cat = cat;
            this.className = className;
            this.channel = channel;
            this.scope = scope;
            this.data = data;
        }
        
        var reqUrl = url.parse(req.url, true);
        resp.writeHead(200, { 'Content-Type': 'text/plain' })
        
        var urlPath = typeof reqUrl.pathname === "string" ? reqUrl.pathname.substring(1) : undefined;
        if (urlPath) {
            try {
                urlPath = decodeURIComponent(urlPath);
            } catch (exception) {
                resp.end("HA API Server bad request received - " + urlPath);         // Can throw URI malformed exception.
                status("SYSTEM/API", "HA API Server bad request received - " + urlPath);         // Can throw URI malformed exception.
                return false;
            }
            
            var splitPath = urlPath.split("/")
            if (splitPath.length === 3) {
                var splitParams = reqUrl.search.split("?")
                if (splitParams.length === 3) {
                    var newMsg = new HAMsg(splitPath[0], splitPath[1], splitPath[2], splitParams[1].split("=")[1], splitParams[2].split("=")[1].replace("%20", " "))// accept multiple parameters for data through web %20 escape
                    exports.toHost(newMsg.cat, newMsg.className, newMsg.channel, newMsg.scope, newMsg.data)
                    status("SYSTEM/API", "API Server executed " + urlPath + ", scope: " + newMsg.scope + ", data: " + newMsg.data)
                    resp.end("HA Server executed API message: " + urlPath + ", scope: " + newMsg.scope + ", data: " + newMsg.data + " - status OK")
                } else {
                    resp.end("HA API Server bad value/data passed - " + reqUrl.search)
                    status("SYSTEM/API", "Bad value/data passed - " + urlPath + " " + reqUrl.search)
                }
            } else {
                resp.end("HA API Server bad API call - " + urlPath)
                status("SYSTEM/API", "Bad API call - " + urlPath)
            }
        }
    }
    
    var APIPort = 8080
    var APIServer = http.createServer(httpAPI);
    var APISvr = APIServer.listen(APIPort);
    APISvr.on("error", function (err) {
        status("SYSTEM/API", "Error with the API server: " + err);
    });
    APISvr.on("close", function () {
        setTimeout(function () {
            status("SYSTEM/HTTP", "API Server closed. Restarting...");
            APIServer.listen(APIPort);
        }, 1000);
    });
    status("SYSTEM/NETWORK", "API server running at port " + APIPort);
}

/////////////////////////// Websockets 
var WebSocket = require("ws");      // https://github.com/einaros/ws/wiki
var netState = "starting"
var msg;
var user;
var wsPort = 1067;
var templMsg = {
    time: Date.now(),               // NEED TO CONVERT TO .NET FORMAT
    func: func.action,
    level: 3,
    network: 1,
    category: "SYSTEM",
    className: "NETWORK",
    instance: null,
    scope: "CONNECT",
    data: ""
}
startNet();

function startNet() {
    ws = new WebSocket("ws://" + _serverName + ":" + wsPort);
    try {
        ws.on("open", function () {
            netState = "connected"
            status("SYSTEM/NETWORK", "Connected to Host. Loading plugins...")
            actionSend("SYSTEM", "SETTINGS", "GET:CATEGORIES()", "", "")                                                // Load settings from server process
            user = "local_machine"
        });

        ws.on("message", function (data, flags) {          // flags.binary will be set if a binary data is received. flags.masked will be set if the data was masked
            var msg = JSON.parse(data)
            //TODO: Check for relevant network number
            //TODO: SOME OF THIS IS NOT RELEVANT FROM CUT/COPY FROM CLIENT JS
            switch (msg.Func) {
                case func.response:
                    switch (msg.Category.toUpperCase()) {
                        case "SYSTEM":    // system
                            switch (msg.ClassName) {
                                case "MISC":
                                    switch (msg.Scope.toUpperCase()) {
                                        case "ALERT":
                                            status("SYSTEM/NETWORK", "Alert message: " + msg.Data)
                                            break;
                                        default:
                                    }
                                    break;
                                    case "SETTINGS":
                                        categories = JSON.parse(msg.Data);
                                        loadPlugins();
                                        break;
                                case "NETWORK":
                                    switch (msg.Instance.toUpperCase()) {
                                        case "SERVER":
                                            switch (msg.Scope.toUpperCase()) {
                                                case "CONNECT":             // user session connected
                                                    user = msg.Data;
                                                    netState = "localsession"
                                                    sessionStarted()
                                                    break;
                                                case "AUTHENTICATED":             // user session connected
                                                    user = msg.Data;
                                                    netState = "usersession"
                                                    status("SYSTEM/NETWORK", "Ready. Logged in as " + user)
                                                    break;
                                                case "DISCONNECT":
                                                    netState = "disconnected";
                                                    user = "";
                                                    break;
                                                default:
                                            }
                                            break;
                                        default:
                                    }
                                    break;
                                default:
                                    pluginMsg(msg);
                            }
                            break;
                        default:
                    }
                    break;
                case func.action:
                    break;
                case func.event:
                        pluginMsg(msg)
                    break;
                case func.error:
                    alert("Error received from Server: " + msg.Data)
                    break;
                default:
                    alert("Do not understand Server message function: " + msg.Func)
                    break;
            }
        });

        ws.on("error", function (evt) {
            status("SYSTEM/NETWORK", "Network Error was reported: " + evt.message);
                setTimeout(startNet, 5000);          // Try again after a delay
        });

        ws.onclose = function (evt) {
            if (netState == "starting") {
                status("SYSTEM/NETWORK", "WARNING - Cannot connect to the server. Please check server availability. Retrying...");
                setTimeout(startNet, 5000);          // Try again after a delay
            } else {
                status("SYSTEM/NETWORK", "Server connection closed");
                netState = "closed"
            }
        }
    } catch (exception) { status("SYSTEM/NETWORK", "ERROR - General Network Error was reported: " + exception); }
}

function eventSend(cat, className, instance, scope, data, log) {
    return msgSend(func.event, cat, className, instance, scope, data, log)
}

function actionSend(cat, className, instance, scope, data, log) {
    return msgSend(func.action, cat, className, instance, scope, data, log)
}

function msgSend(msgFunc, cat, className, instance, scope, data, log) {
    try {
        templMsg.time = Date.now();
        templMsg.level = 3;
        if (log === false) templMsg.level = 0;
        templMsg.network = 1;                                    // Default network
        templMsg.category = cat.toString().toUpperCase();                             
        templMsg.func = msgFunc;                             // Raise user or system action
        templMsg.className = className.toString();
        templMsg.instance = instance.toString();
        templMsg.scope = scope.toString();
        templMsg.data = data.toString();
        (function (cat, className, instance, scope, data, log) {
            ws.send(buildJSON(templMsg), function (error) {
                if (error !== undefined) {
                    status("SYSTEM/NETWORK", "ERROR - Network Send error was reported : " + error.message)    // if error is null, the send has been completed, otherwise the error object will indicate what failed.
                    return error.message
                } else {
                    status(cat + "/" + className, instance + "(" + scope + "): " + data)
                    for (var plugNum in plugins) {
                        if (plugins[plugNum].className.toUpperCase() === className.toUpperCase()) {
                            if (plugins[plugNum].category.toUpperCase() === cat.toUpperCase()) {
                                plugins[plugNum].lastMsg = templMsg;
                            }
                        }
                    }
                    return "OK"
                }
            });
        })(templMsg.category, templMsg.className, templMsg.instance, templMsg.scope, templMsg.data, templMsg.level);
        return "OK"
    } catch (exception) { 
        status("SYSTEM/NETWORK", "ERROR - Network Send error was reported : " + exception); 
        return exception;
    }
}

function buildJSON(myMsg) {
    var myJSONObject = {            //TODO: Put in the actual time
        "Time": "0001-01-01 00:00:00Z", "Func": myMsg.func, "Level": myMsg.level, "Network": myMsg.network, "Category": myMsg.category, "ClassName": myMsg.className, "Instance": myMsg.instance, "Scope": myMsg.scope, "Data": myMsg.data
    }
    return JSON.stringify(myJSONObject)
}

/////////////////// Manage connections with Azure websockets proxy
var ws, remWs, locWs;
var wsPortRemote = 80
var wsPortClient = 1066
var remoteHost = "HAProxy.azurewebsites.net"
var remoteState = "starting"
var remClientState = "unconnected"
startRemote();

function startRemote() {
    remWs = new WebSocket("ws://" + remoteHost + ":" + wsPortRemote + "/HAServer");
    try {
        remWs.on("open", function () {
            remoteState = "connected"
            status("SYSTEM/NETWORK", "Connected to remote Host. Waiting for remote connections")
            user = "local_machine"
            locWs = new WebSocket("ws://" + _serverName + ":" + wsPortClient);
            locWs.on("open", function () {
                remClientState = "session"
                status("SYSTEM/NETWORK", "Session with local host setup for transferring messages from remote")
            });
            locWs.on("message", function (data, flags) {          // flags.binary will be set if a binary data is received. flags.masked will be set if the data was masked
                if (remWs.readyState === 1) {
                    remWs.send(data)                        // relay to remote host
                    status("SYSTEM/NETWORK", "relayed data to remote client: " + data)
                } else {
                    status("SYSTEM/NETWORK", "Remote relay not open - state: " + remWs.readyState)
                }
            });
            locWs.on("error", function (evt) {
                status("SYSTEM/NETWORK", "Error with connection to remote client: " + evt.message);
            });
            locWs.on("close", function (evt) {
                status("SYSTEM/NETWORK", "session with remote client closed");
                remClientState = "closed"
            });
        });
        
        remWs.on("message", function (data, flags)
        {
          // flags.binary will be set if a binary data is received. flags.masked will be set if the data was masked
            if (locWs.readyState === 1) {
                locWs.send(data)                        // relay to local host
                status("SYSTEM/NETWORK", "relayed data from remote client: " + data)
            } else {
                status("SYSTEM/NETWORK", "local host not open - state: " + remWs.readyState)
            }
        });
        
        remWs.on("error", function (evt) {
            status("SYSTEM/NETWORK", "Could not establish session with cloud host: " + evt.message);
            setTimeout(startRemote, 5000);          // Try again after a delay
        });
        
        remWs.on("close", function (evt) {
            if (remoteState == "starting") {
                status("SYSTEM/NETWORK", "WARNING - Cannot connect to the cloud host. Please check network availability. Retrying...");
            } else {
                status("SYSTEM/NETWORK", "Cloud host network closed: " + evt);
            }
            remoteState = "closed"
            locWs.close();                          // disconnect local Server session 
            setTimeout(startRemote, 3000);          // Try again after a delay
        });


    } catch (exception) { status("SYSTEM/NETWORK", "ERROR - General Remote connection network error was reported: " + exception); }
}

//////////////// Utilities
function status(caller, msg) {
    var currDate = new Date();
    console.log(currDate.getHours() + ":" + currDate.getMinutes() + ":" + currDate.getSeconds() + "." + currDate.getMilliseconds() + "\t[" + caller + "]\t" + msg);
}

function toLowerKey(obj) {
    for (var key in obj) {                    // Make all keys lower case
        var keyLower = key.toLowerCase();
        if (keyLower !== key) {
            var temp = obj[key];
            delete obj[key];
            obj[keyLower] = temp;
        }
    }
    return obj
}

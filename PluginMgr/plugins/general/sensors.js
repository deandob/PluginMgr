"use strict";
var mqttServer = require('mqtt-server');
var servers;

function startup() {
        servers = mqttServer({
            mqtt: 'tcp://' + serverName + ':' + fw.settings.mqttport,
            //mqtts: 'ssl://' + serverName + ':8883',
            mqttws: 'ws://' + serverName + ':' + (parseInt(fw.settings.mqttport) + 1).toString(),
            //mqtwss: 'wss://' + serverName + ':8884'
        }, {
            //ssl: {
            //    key: fs.readFileSync('./server.key'),
            //    cert: fs.readFileSync('./server.crt')
            //},
            emitEvents: true // default
        }, function (client) {
            client.on('connect', function (data) {
                fw.log('Client MQTT connected: ' + data.clientId)
                client.connack({
                    sessionPresent: false, 
                    returnCode: 0
                });
            });
            client.on('data', function (data) {
                //console.log('Client MQTT data: ' + data.toString())
            });
            client.on('error', function (error) {
            fw.log('Client error: ' + error)
            });
            client.on('subscribe', function (req) {
                fw.log('Client Subscribing to: ' + req.subscriptions[0].topic)
                var granted = [];
                granted[0] = 0;
                client.suback({
                    messageId: req.messageId,
                    granted: granted
                });

            });
            client.on('publish', function (req) {
                fw.log('Client Pub: ' + req.topic + " " + req.payload.toString())
                switch (req.qos) {
                    case 0:
                        sendHost(req.topic.toString(), req.payload.toString());
                        break;
                    case 1:
                        sendHost(req.topic.toString(), req.payload.toString());
                        client.puback({
                            messageId: req.messageID, 
                            returnCode: 0
                        });
                        break;
                    case 2:
                        sendHost(req.topic.toString(), req.payload.toString());
                        client.pubrec({
                            messageId: req.messageID, 
                            returnCode: 0
                        });
                        break;
                    default:
                }
            });
        });
               
        servers.listen(function () {
            fw.log('MQTT Server listening on port ' + fw.settings.mqttport);
        });
    
    return "OK"                                                     // Return 'OK' only if startup has been successful to ensure startup errors disable plugin
}

function sendHost(topic, data) {            // cat/class/instance/scope in topic name, data in payload
    var splitPath = topic.split("/")
    if (splitPath.length === 4) {
        exports.toHost(splitPath[0], splitPath[1], splitPath[2], splitPath[3], data)
        fw.log("MQTT Server executed " + topic + ", data: " + data)
        return 0;
    } else {
        fw.log("Bad MQTT topic - " + topic);
        return 1;
    }
}
 

// Receive a message from the host
exports.fromHost  = function(channel, scope, data) {
    //Insert code to manage messages from the host
}

// Shutdown the plugin
exports.shutPlugin = function shutPlugin(param) {
    //Insert any orderly shutdown code needed here
    return "OK"
}

// Initialize the plugin - DO NOT MODIFY THIS FUNCTION
var fw = new Object();
exports.loaded = function (iniCat, iniName, iniChannels, iniSettings, iniStore) {
    fw.cat = iniCat;
    fw.plugName = iniName;
    fw.channels = iniChannels;
    fw.settings = iniSettings;
    fw.store = iniStore;
    fw.restart = function (code) { module.parent.exports.restart(code) };
    fw.log = function (msg) { module.parent.exports.log(fw.cat + "/" + fw.plugName, msg) };
    fw.toHost = function (myChannel, myScope, myData, myLog) { module.parent.exports.toHost(fw.cat, fw.plugName, myChannel, myScope, myData, myLog) };
    fw.addChannel = function (name, desc, type, io, min, max, units, attribs, value, store) { module.parent.exports.addChannel(fw.cat, fw.plugName, name, desc, type, io, min, max, units, attribs, value, store) };
    return startup();
}

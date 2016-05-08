"use strict";
var net = require('net')
    , mqttCon = require('mqtt-connection')
  , server = new net.Server();
var self = [];

var serverName = require("os").hostname();
var servers;
/*
//var mqttServer = require('mqtt-server');
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
*/

function startup() {
    //---------------------------
    // Load mqtt-connection
    //---------------------------
    
    //---------------------------
    // Create MQTT server
    //---------------------------
    
    server.on('connection', function (stream) {
        //---------------------------
        // Get client
        //---------------------------
        
        var client = mqttCon(stream);
        
        //---------------------------
        // Client connected
        //---------------------------
        
        client.on('connect', function (packet) {
            //---------------------------
            // Connection acknowledgement
            //---------------------------
            fw.log("CONNECTED");
            client.connack({ returnCode: 0 });
            
            //---------------------------
            // Set client ID
            //---------------------------
            
            client.id = packet.clientId;
            
            //---------------------------
            // Save client's last seen
            //---------------------------
            
            client.last_seen = Math.round(new Date().getTime() / 1000);
            
            //---------------------------
            // Save in clients[] array
            //---------------------------
            
            self.clients[ client.id ] = client;
        });
        
        //---------------------------
        // Client published
        //---------------------------
        
        client.on('publish', function (packet) {
            //---------------------------
            // Save client's last seen
            //---------------------------
            
            client.last_seen = Math.round(new Date().getTime() / 1000);

        //---------------------------
        // Handle publish if you need to
        //---------------------------
        });
        
        //---------------------------
        // Client pinged
        //---------------------------
        
        client.on('pingreq', function (packet) {
            //---------------------------
            // Save client's last seen
            //---------------------------
            
            client.last_seen = Math.round(new Date().getTime() / 1000);
            
            //---------------------------
            // Respond
            //---------------------------
            
            client.pingresp();
        });
        
        //---------------------------
        // Client disconnected
        //---------------------------
        
        client.on('disconnect', function (packet) {
            //---------------------------
            // Remove from clients
            //---------------------------
            
            if (self.clients[client.id]) {
                delete self.clients[client.id];
            }
            
            //---------------------------
            // End stream
            //---------------------------
            
            client.stream.destroy();
            client.stream.end();
        });
        
        //---------------------------
        // Client closed connection
        //---------------------------
        
        client.on('close', function (err) {
            //---------------------------
            // Remove from clients
            //---------------------------
            
            if (self.clients[client.id]) {
                delete self.clients[client.id];
            }
            
            //---------------------------
            // End stream
            //---------------------------
            
            client.stream.destroy();
            client.stream.end();
        });
        
        //---------------------------
        // Client connection error
        //---------------------------
        
        client.on('error', function (err) {
            //---------------------------
            // Remove from clients
            //---------------------------
            
            if (self.clients[client.id]) {
                delete self.clients[client.id];
            }
            
            //---------------------------
            // End stream
            //---------------------------
            
            client.stream.destroy();
            client.stream.end();
        });
    }).listen(fw.settings.mqttport);
    return "OK"                                                     // Return 'OK' only if startup has been successful to ensure startup errors disable plugin
}



function sendHost(topic, data) {            // cat/class/instance/scope in topic name, data in payload
    var splitPath = topic.split("/")
    if (splitPath.length === 4) {
        fw.toHost(splitPath[0], splitPath[1], splitPath[2], splitPath[3], data)
        fw.log("MQTT Server executed " + topic + ", data: " + data)
        return 0;
    } else {
        fw.log("Bad MQTT topic - " + topic);
        return 1;
    }
}
 

// Receive a message from the host
function fromHost(channel, scope, data) {
    //Insert code to manage messages from the host
}

// Shutdown the plugin
function shutPlugin(param) {
    //Insert any orderly shutdown code needed here
    return "OK"
}

// Initialize the plugin -------------- DO NOT MODIFY THIS SECTION
var fw = new Object();
process.on('message', function (msg) {
    var retval;
    switch (msg.func.toLowerCase()) {
        case "init":
            fw.cat = msg.data.cat;
            fw.plugName = msg.data.name;
            fw.channels = msg.data.channels;
            fw.settings = msg.data.settings;
            fw.store = msg.data.store;
            fw.restart = function (code) { process.exit(code) };
            fw.log = function (msg) { process.send({ func: "log", cat: fw.cat, name: fw.plugName, log: msg }); };
            fw.toHost = function (myChannel, myScope, myData, myLog) { process.send({ func: "tohost", cat: fw.cat, name: fw.plugName, channel: myChannel, scope: myScope, data: myData, log: myLog }); };
            fw.addChannel = function (name, desc, type, io, min, max, units, attribs, value, store) { process.send({ func: "addch", cat: fw.cat, name: fw.plugName, channel: name, scope: desc, data: { type: type, io: io, min: min, max: max, units: units, attribs: attribs, value: value, store: store } }); };
            fw.writeIni = function (section, subSection, key, value) { process.send({ func: "writeini", cat: fw.cat, name: fw.plugName, data: { section: section, subSection: subSection, key: key, value: value } }); };
            retval = startup();
            break;
        case "fromhost":
            retval = fromHost(msg.channel, msg.scope, msg.data)
            break;
        case "shutdown":
            retval = shutPlugin(msg.data);
            break;
    }
    process.send({ func: msg.func, cat: fw.cat, name: fw.plugName, data: retval, log: process.execArgv[0] });
});

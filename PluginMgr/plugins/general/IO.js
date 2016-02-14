"use strict";

// Connect to IO board via USB CDC Serial
var com = require("serialport");

var serialIO;
var oldState;

// startup function
function startup() {
    var startStatus = "OK"

    serialIO = new com.SerialPort("\\\\.\\" + fw.settings.comport, {
        baudrate: +fw.settings.baudrate,
        databits: +fw.settings.databits,
        stopbits: +fw.settings.stopbits,
        parity: fw.settings.parity,
        buffersize: 255,
    }, true, function (err) {
        if (err) fw.log(err + ". Cannot open IO serial port, no IO usage functionality available.")
        startStatus = err;
    });
    
    //TODO: open error is async, so can't return errors.... Wait until serial port is open before returning
       
    serialIO.on("open", function () {
        fw.log("Serial port open on " + fw.settings.comport);
        serialWrite(fw.settings.incmd, 0, 0);       // Get initial input port values
        
    });
    
    serialIO.on("data", function (data) {
        serialRecv(data);
    });
    
    serialIO.on("error", function (err) {
        fw.log("Serial port error " + err);
        fw.restart(99);
    });
    
    return startStatus
}

function serialWrite(cmdByte, data0, data1) {
    fw.log("---------------------------------------------------------------------------------------------- " + cmdByte + " " + data0 + " " + data1)
    serialIO.write(new Buffer([+fw.settings.HeaderCmd, +cmdByte, +data0, +data1]), function (err, cmdPort) {
        if (err) {
            fw.log("Can't write command " + cmdByte + ". Serial write error: " + err);
            fw.restart(99);
        }
    });
}

function serialSend(cmd, channelName, data) {         // Set output port on / off
    var portNum = null;
    for (var i = 0; i < fw.channels.length; i++) {
        if (channelName.toString().toUpperCase() === fw.channels[i].name.toUpperCase()) {     // Find port number from channel name
            if (+data > 1) data = 1;
            serialWrite(+cmd, i, +data)
            return;
        }
    }
}

function serialRecv(data) {     // change on input ports
//    fw.log("===================================================================================== " + data.length + " " + data[0] + " " + data[1] + " " + data[2])  
    if (data.length == 3) {
        switch (data[1]) {
            case +fw.settings.incmd:
                var mask = 1;
                var changedBits;
                if (typeof oldState === "undefined") {
                    changedBits = 255;                  // send all port values initially
                    serialWrite(fw.settings.ledcmdon, 0, 0);      // turn on indicator LED as we have initialised successfully
                } else {
                    changedBits = oldState ^ data;      // Get changed bits
                }
                if (changedBits) {
                    for (var i = 0; i < 8; i++) {
                        if ((changedBits & mask) && (typeof fw.channels[i] === "object")) {
                            fw.toHost(fw.channels[i].name, "changed", ((data & mask) >> i).toString());
                        }
                        mask = mask << 1;
                    }
                    oldState = data;
                }
                break;
        }
    }
}

// Process host messages
function fromHost(channel, scope, data) {
    serialSend(fw.settings.outcmd, channel, data);
    return "OK"
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
            fw.restart = function (code) { process.send({ func: "restart", data: code }); };
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

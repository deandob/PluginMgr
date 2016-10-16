﻿"use strict";

// Read power generated by solar panel inverter
var com = require("serialport");
var serialSolar;
var CR = "\r";
var oldVal = [];
var chCount = 0;

// startup function
function startup() {
    var startStatus = "OK"
   
    startSerialPort();
    setInterval(pollInv, +fw.settings.pollinterval * 1000);
    
    return startStatus
}

function startSerialPort() {
    serialSolar = new com(fw.settings.comport, {
            baudrate: +fw.settings.baudrate,
            databits: +fw.settings.databits,
            stopbits: +fw.settings.stopbits,
            parity: fw.settings.parity,
            buffersize: 255
            //parser: com.parsers.readline('\r\n')
        }, function (err) {
        if (err) fw.log(err + ". Cannot open solar serial port, no solar generation functionality available.")
    });

    serialSolar.on("open",function() {
        fw.log("Serial port open on " + fw.settings.comport);
    });
        
    serialSolar.on("data", function(data) {
        serialRecv(data);
    });
    
    serialSolar.on("error", function (err) {
        fw.log("Serial port general error " + err);
        startSerialPort();
        fw.restart(99);
    });

    for (var lp = 0; lp < fw.channels.length; lp++) oldVal[lp] = -99;
}

function pollInv() {
    chCount = 0;
    sendInv(fw.channels[chCount].attribs[0].value);
}

function sendInv(solarCmd) {
    try {
        serialSolar.write(new Buffer(solarCmd + fw.settings.cmdchar + CR), function (err) {
            if (err) {
                fw.log("Serial write error: " + err);
                fw.restart(99);
            }
        })
    } catch (e) { fw.log("Serial write error: " + e); }    
}

function serialRecv(data) {
    if (data.length > 0) {
        var respValue = parseInt(data.toString().split(CR)[0]);
        if (respValue < fw.settings.changetol) respValue = 0                        // ignore any spurious watts generated at night
        if (Math.abs(respValue - oldVal[chCount]) >= fw.settings.changetol) {
           fw.toHost(fw.channels[chCount].name, fw.channels[chCount].units, respValue)
           oldVal[chCount] = respValue;
        }
        chCount = chCount + 1;
    }
    if (chCount != fw.channels.length) {
        sendInv(fw.channels[chCount].attribs[0].value);
    } else {
        chCount = 0;                 // cycle through channels
    }
}

function closeSerial() {
    serialSolar = undefined;
}

//Functions: VIN, VOUT, MEASTEMP, TIME, WHLIFE, KWHTODAY, MPPTSTAT, IIN, IOUT, PIN, POUT.

/*
function pollInvPatch(cmd) {
    if (serialSolar) serialSolar.close();    
    serialSolar = new com.SerialPort(fw.settings.comport, {
        baudrate: +fw.settings.baudrate,
        databits: +fw.settings.databits,
        stopbits: +fw.settings.stopbits,
        parity: fw.settings.parity,
        buffersize: 255
            //parser: com.parsers.readline('\r\n')
    }, function (err) {
        if (err) {
            if (serialSolar) serialSolar.close();
            fw.log(err + ". Cannot open solar serial port, skipping cycle.")
        }
    });
        
    serialSolar.on("data", function (data) {
        serialRecvPatch(data);
    });
    
    serialSolar.on("error", function (err) {
        fw.log("Serial port general error " + err);
        //debugger
        //fw.restart(99);
    });
 
    serialSolar.on("open", function () {
//        fw.log("Serial port open on " + fw.settings.comport);
          serialSolar.write(new Buffer(cmd + fw.settings.cmdchar + CR), function (err) {
            if (err) {
                fw.log("Serial write error: " + err);
                //fw.restart(99);
            }
          })
    });
}

function serialRecvPatch(data) {
        if (data.length > 0) {
            var generated = parseInt(data.toString().split(CR)[0])
            if (generated < fw.settings.changetol) generated = 0                        // ignore any spurious watts generated at night
            if (Math.abs(generated - oldData) >= fw.settings.changetol) {
                fw.toHost("Power Out", "W", generated)
                oldData = generated
        }
        serialSolar.close(closeSerial)
    }
}
*/

// Process host messages
function fromHost(channel, scope, data) {
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

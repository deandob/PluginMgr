"use strict";

// Connect to IO board via USB CDC Serial
var com = require("serialport");

var serialIO;
var oldState;
var intervalTimer;
var pingACK = true;
var intervalTimer;

// startup function
function startup() {
    var startStatus = "OK"
    serialIO = new com("\\\\.\\" + fw.settings.comport, {
        baudrate: +fw.settings.baudrate,
        databits: +fw.settings.databits,
        stopbits: +fw.settings.stopbits,
        parity: fw.settings.parity,
        buffersize: 255,
    }, function (err) {
        if (err) {
            fw.log(err + ". Cannot open IO serial port, no IO usage functionality available. Restarting in 5 seconds...");
            setTimeout(fw.reset, 5000, 1);
        }
    });
    
    //TODO: open error is async, so can't return errors.... Wait until serial port is open before returning
       
    serialIO.on("open", function () {
        fw.log("Serial port open on " + fw.settings.comport);
        serialWrite(fw.settings.incmd, 0, 0);       // Get initial input port values
        intervalTimer = setInterval(pingHW, 5000);                   // ping USB every 5 seconds as a watchdog
    });
    
    serialIO.on("data", function (data) {
        serialRecv(data);
    });
    
    serialIO.on("error", function (err) {
        fw.log("Serial port error " + err + ". Restarting plugin in 5 seconds...");
        if (serialIO.isOpen()) serialIO.close();
        clearInterval(intervalTimer);
        setTimeout(fw.restart, 5000, 1);             // Try again
    });
    
    return startStatus
}

// board connected watchdog check, allows hotswap of the IO USB board
function pingHW() {
    if (pingACK == false) {
        fw.log("ERROR - Can't detect IO board, restarting plugin in 5 seconds....");
        if (serialIO.isOpen()) serialIO.close();
        clearInterval(intervalTimer);
        setTimeout(fw.restart, 5000, 1);             // Try again
    } else {
        pingACK = false;
        serialWrite(fw.settings.ledcmdon, 0, 0);
    }
}

function serialWrite(cmdByte, data0, data1) {
//    fw.log("******************************************************* serial write " + cmdByte + "-" + data0 + "-" + data1)
    serialIO.write(new Buffer([+fw.settings.HeaderCmd, +cmdByte, +data0, +data1]), function (err, cmdPort) {
        if (err) {
            fw.log("Can't write command " + cmdByte + ". Serial write error: " + err + ". Restarting plugin in 5 seconds...");
            if (serialIO.isOpen()) serialIO.close();
            clearInterval(intervalTimer);
            setTimeout(fw.restart, 5000, 1);             // Try again
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

function serialRecv(data) {     // change on input ports. 1st Byte is the size of the packet, 2nd byte is the function, remaining bytes data. All ACKs are the orginal command + 128
//    fw.log("===================================================================================== L" + data.length + "-" + data[0] + "-" + data[1] + "-" + data[2])  
        switch (data[1]) {
            case (+fw.settings.ledcmdon + 128):// ACK for device name ping
                pingACK = true;
                break;
            case +fw.settings.portchanged:                      // async port changed
            case +fw.settings.incmd:                            // Port settings requested
                var mask = 1;
                var changedBits;
                if (typeof oldState === "undefined") {
                    changedBits = 255;                  // send all port values initially
                    serialWrite(fw.settings.ledcmdon, 0, 0);      // turn on indicator LED as we have initialised successfully
                } else {
                    changedBits = oldState ^ data[2];      // Get changed bits
                }
                if (changedBits) {
                    for (var i = 0; i < 8; i++) {
                        if ((changedBits & mask) && (typeof fw.channels[i + 8] === "object")) {
                            fw.toHost(fw.channels[i + 8].name, "changed", ((data[2] & mask) >> i).toString());      // channels 8 - 15 inputs
                        }
                        mask = mask << 1;
                    }
                    oldState = data[2];
                }
                break;
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

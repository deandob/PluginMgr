"use strict";

// Connect to IO board via USB CDC Serial
var com = require("serialport");

var serialIO;

// startup function
function startup() {
    var startStatus = "OK"

    serialIO = new com.SerialPort("\\\\.\\" + fw.settings.comport, {
        baudrate: +fw.settings.baudrate,
        databits: +fw.settings.databits,
        stopbits: +fw.settings.stopbits,
        parity: fw.settings.parity,
        buffersize: 255,
        //parser: com.parsers.readline('\r\n')
    }, true, function (err) {
        if (err) fw.log(err + ". Cannot open IO serial port, no IO usage functionality available.")
        startStatus = err;
    });
    
    //TODO: open error is async, so can't return errors.... Wait until serial port is open before returning
       
    serialIO.on("open", function () {
        fw.log("Serial port open on " + fw.settings.comport);
        serialIO.write(new Buffer([+fw.settings.HeaderCmd, 51, 1, 1]), function (err) {
            if (err) {
                fw.log("Serial write error: " + err);
                fw.restart(99);
            }
        });
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

// <msg><src>CC128-v1.18</src><dsb>00014</dsb><time>09:28:59</time><tmpr>29.9</tmpr><sensor>2</sensor><id>00692</id><type>1</type><ch1><watts>00481</watts></ch1><ch2><watts>00318</watts></ch2><ch3><watts>01320</watts></ch3></msg>
// Power info sent every 6 seconds, history data every odd hour
function serialRecv(data) {
    try {
        var recvSens
        if (data.length > 0) {
        }
    } catch (e) {
        debugger
        console.dir("IO Error occurred: " + e + " " + e.stack)
    }
}

function writeUSB(channel, scope, data) {
    try {
        serialIO.write(new Buffer([+fw.settings.HeaderCmd, +fw.settings.outcmd, +channel, +data]), function (err) {
            if (err) {
                fw.log("Serial write error: " + err);
                fw.restart(99);
            }
        });
    } catch (e) { fw.log("Serial write error: " + e); }
}

// Process host messages
exports.fromHost = function fromHost(channel, scope, data) {
    writeUSB(channel, scope, data);
    return "OK"
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

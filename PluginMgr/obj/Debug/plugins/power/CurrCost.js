"use strict";

// Read power from Current Cost (transactional power reading, not history)
var com = require("serialport");
var parseXML = require("xml2js").parseString;

var serialPower;

var sensors = [];
var sensor = function(ch0, ch1, ch2) {
    this.ch0 = ch0;
    this.ch1 = ch1;
    this.ch2 = ch2;
}

var sensCh = function () {
    this.active = false;
    this.cost = 0;
    this.rate = 0;
    this.currW = -99;
    this.oldW = 0;
}

// startup function
function startup() {
    var startStatus = "OK"
    serialPower = new com.SerialPort(fw.settings.comport, {
            baudrate: +fw.settings.baudrate,
            databits: +fw.settings.databits,
            stopbits: +fw.settings.stopbits,
            parity: fw.settings.parity,
            buffersize: 255,
            parser: com.parsers.readline('\r\n')
        }, true, function(err) {
            if (err) fw.log(err + ". Cannot open power serial port, no power usage functionality available.")
            startStatus = err;
    });

    //TODO: open error is async, so can't return errors.... Wait until serial port is open before returning

    var numSensors = 0                    // find the number of transmitters in the ini file (attrib[1] = transmitter index for a channel)
    for (var chLp = 0; chLp < fw.channels.length; chLp++) {
        if (+fw.channels[chLp].attribs[1].value === numSensors) {       // Get highest sensor index from ini
            numSensors = +fw.channels[chLp].attribs[1].value + 1
        }
    }
    if (numSensors === 0) {
        fw.log("ERROR - No sensors found for power. No power channels will be monitored");
        return "NO SENSORS";
    } 

    // Populate sensor object based on settings
    for (var sens = 0; sens < numSensors; sens++) {
        sensors.push(new sensor(new sensCh(), new sensCh(), new sensCh()))
        for (var chLp = 0; chLp < fw.channels.length; chLp++) {
            if (+fw.channels[chLp].attribs[1].value === sens) {
                var ch = "ch" + fw.channels[chLp].attribs[2].value
                sensors[sens][ch].active = true;
            }
        }
    }

    serialPower.on("open",function() {
        fw.log("Serial port open on " + fw.settings.comport);
    });
        
    serialPower.on("data", function (data) {
        console.log("in currcost recv")
        serialRecv(data);
        console.log("out currcost recv")
    });
    
    serialPower.on("error", function(err) {
        fw.log("Serial port error " + err);
    });

    return startStatus
}

// <msg><src>CC128-v1.18</src><dsb>00014</dsb><time>09:28:59</time><tmpr>29.9</tmpr><sensor>2</sensor><id>00692</id><type>1</type><ch1><watts>00481</watts></ch1><ch2><watts>00318</watts></ch2><ch3><watts>01320</watts></ch3></msg>
// Power info sent every 6 seconds, history data every odd hour
function serialRecv(data) {
    try {
        var recvSens
        if (data.length > 0) {
            var tt = data.toString()
            //fw.log("received power Msg: " + data.toString());
            if (data.toString().substr(0, 5) === "<msg>" && data.length < 255)
            {
             // history data will overflow serial input buffer so will receive history data in parts, so ignore fragments
                parseXML(data, function (err, XMLDoc) {
                    if (err) {
                        fw.log("Error occurred parsing power XML " + data + ". Error: " + err);
                    } else {
                        if (XMLDoc.msg["tmpr"])
                        {
            // Real time record (ignore history)
                            var recvSens = +XMLDoc.msg.sensor[0] - 1
                            if (recvSens !== undefined) {
                                for (var lp = 0; lp < fw.channels.length; lp++) {
                                    if (+fw.channels[lp].attribs[1].value === recvSens)
                                    {
                   // is our loop channel in the sensor # received?
                                        var lpCh = +fw.channels[lp].attribs[2].value
                                        if (XMLDoc.msg["ch" + (lpCh + 1)] !== undefined)
                                        {
                      // Does channel exist in the message? (our channel num starts at 0, current cost initial channel starts at 1)
                                            var ch = "ch" + lpCh
                                            sensors[recvSens][ch].oldW = sensors[recvSens][ch].currW
                                            sensors[recvSens][ch].currW = parseInt(XMLDoc.msg["ch" + (lpCh + 1)][0].watts[0])
                                            //sensors[recvSens][ch].cost = (sensors[recvSens][ch].currW * sensors[recvSens][ch].rate / 100000 + 0.005).toFixed(2)     // $/kwH = 1000w * 100cents
                                            
                                            if (sensors[recvSens][ch].currW > sensors[recvSens][ch].oldW + fw.settings.changetol || sensors[recvSens][ch].currW < sensors[recvSens][ch].oldW - fw.settings.changetol) {
                                                //fw.log("Power Sensor #" + (recvSens) + " Ch" + lp + ": " + sensors[recvSens][ch].currW + "w cost: $" + sensors[recvSens][ch].cost)
                                                fw.toHost(fw.channels[lp].name, "W", sensors[recvSens][ch].currW)           // broadcast power changes outside tolerance limits
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                });
            }
        }
    } catch (e) {
        debugger
        console.dir("CurrCost Error occurred: " + e + " " + e.stack)
    }
}        

// Process host messages
exports.fromHost = function fromHost(channel, scope, data) {
    return "OK"
}

// Shutdown the plugin
exports.shutPlugin = function shutPlugin(param) {
    //Insert any orderly shutdown code needed here
    return "OK"
}

// Initialize the plugin - DO NOT MODIFY THIS FUNCTION
var fw = new Object();
exports.loaded = function(iniCat, iniName, iniChannels, iniSettings, iniStore) {
    fw.cat = iniCat;
    fw.plugName = iniName;
    fw.channels = iniChannels;
    fw.settings = iniSettings;
    fw.store = iniStore;
    fw.log = function (msg) { module.parent.exports.log(fw.cat + "/" + fw.plugName, msg) };
    fw.toHost = function (myChannel, myScope, myData) {module.parent.exports.toHost(fw.cat, fw.plugName, myChannel, myScope, myData)};
    fw.addChannel = function (name, desc, type, io, min, max, units, attribs, value, store) {module.parent.exports.addChannel(fw.cat, fw.plugName, name, desc, type, io, min, max, units, attribs, value, store)};
    return startup();
}

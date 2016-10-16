"use strict";
///////////////////// User routines
var com = require("serialport");
var fs = require("fs");
var parseXML = require("xml2js").parseString;
var serialCBUS;
var SEND_THROTTLE = 150;               // Time to sleep between multiple CBUS commands
var sendQ = [];
var CR = "\r";
var projName, netName;
var MMILp = 0;
var MMISync = 0;
var sendReady = true;
var lastMsg = ""
var CBUSApp = "38"                  // CBUS lighting application number

var grpStates = [];

var grpState = function() {
    this.active = false;
    this.name = "";
    this.ID = "";
    this.state = "";
    this.level = null;
    this.lights = true;
    this.watts = 0;
}
for (var lp = 0; lp < 256; lp++) grpStates.push(new grpState());        // Initialise CBUS state array to 0

// http://training.clipsal.com/downloads/OpenCBus/Serial%20Interface%20User%20Guide.pdf pg 49)
// "\05FF007A38004A" Short form status request, not used here
var syncMMI = [{syncMsg: "\\05FF00730738004A", syncRecv: 31},           // Sync messages to retreive status for all groups
    {syncMsg: "\\05FF00730738202A", syncRecv: 63}, 
    {syncMsg: "\\05FF00730738400A", syncRecv: 95}, 
    {syncMsg: "\\05FF0073073860EA", syncRecv: 127}, 
    {syncMsg: "\\05FF0073073880CA", syncRecv: 159}, 
    {syncMsg: "\\05FF00730738A0AA", syncRecv: 191}, 
    {syncMsg: "\\05FF00730738C08A", syncRecv: 223}, 
    {syncMsg: "\\05FF00730738E06A", syncRecv: 255}] 

// startup function
function startup() {
    var startStatus = "OK"
    serialCBUS = new com(fw.settings.comport, {
        baudrate: +fw.settings.baudrate,
        databits: +fw.settings.databits,
        stopbits: +fw.settings.stopbits,
        parity: fw.settings.parity,
        buffersize: 255
            //parser: com.parsers.readline('\r\n')
        }, function(err) {
            if (err) fw.log(err + ". Cannot open CBUS serial port, no lighting functionality available.");
            startStatus = err;
    });

    serialCBUS.on("open",function() {
        fw.log("Serial port open on " + fw.settings.comport);
        getTags()
        
        initCBUS();

        regularSync()                   // Extract detailed group status from the network        
    });
        
    serialCBUS.on("data", function (data) {
        serialRecv(data);
    });
    
    serialCBUS.on("error", function(err) {
        fw.log("Serial port error " + err);
        fw.restart(99);
    });

    return startStatus                                 // Return 'OK' only if startup has been successful to ensure startup errors disable plugin
}

function initCBUS() {
    // Initialise CBUS. Don't get additional network info, and don't receive regular MMI messages (request sync each hour)
    sendQ.push("~~~")               // Reset + Address filter #1 Capture all status requests (FF)
    sendQ.push("@A32100FF")         // Reset + Address filter #1 Capture all status requests (FF)
    sendQ.push("@A32200FF")         // Address filter #2. Capture all status requests (FF)
    sendQ.push("@A3420002")         // Option register #3, Local SAL on, EXSTAT ON
    sendQ.push("@A3300019")         // Connect (bit0=1), use checksum (Bit3=8), smart (bit4=16), no monitor (bit5=32), no IDMON (bit6=64) = 25 = 0x19
    
    sendSerial()                    // startup async send queue
}

// Parse with group names and addresses into local array from c-gate XML
function getTags() {
    var CBUSTags = fs.readFileSync(fw.settings.xmldoc, "utf-8")
    parseXML(CBUSTags, function (err, XMLDoc) {
        if (err) {
            fw.log("Error occurred parsing CBUS group XML " + fw.settings.xmldoc + ". Error: " + err);
        } else {
            //TODO: Search for project and network names from ini file instead of hard coding to 0 index
            var CBUSProj = XMLDoc.Installation.Project[0]
            projName = CBUSProj.Address[0]
            netName = CBUSProj.Network[0].TagName[0]

            for (var applp = 0; applp < CBUSProj.Network[0].Application.length; applp++) {

                if (CBUSProj.Network[0].Application[applp].TagName[0].toLowerCase() === "lighting") {

                    for (var lightlp = 0; lightlp < CBUSProj.Network[0].Application[applp].Group.length; lightlp++) {
                        var grpAdd = +CBUSProj.Network[0].Application[applp].Group[lightlp].Address[0]
                        var name = CBUSProj.Network[0].Application[applp].Group[lightlp].TagName[0]
                        fw.log("Loaded CBUS Grp: " + name + ", Addr: " + grpAdd +" Level:" + grpStates[grpAdd].level)

                        if (name.indexOf("(") > -1) {
                            grpStates[grpAdd].watts = parseInt(name.substr(name.indexOf("(") + 1, name.length - name.indexOf("(") - 2))
                            grpStates[grpAdd].name = (name.substr(0, name.indexOf("(") - 1)).trim().capitalize()
                        } else {
                            grpStates[grpAdd].name = name.trim().capitalize()
                            grpStates[grpAdd].watts = 0
                        }
                        fw.addChannel(grpStates[grpAdd].name, grpStates[grpAdd].watts + " Watts", "light", "inputoutput", 0, 100, "percent", [{name: "power", type: "watts", value: grpStates[grpAdd].watts}])
                    }
                }
            }
        }
    });
}

String.prototype.capitalize = function() {
    return this.toLowerCase().replace(/(?:^|\s)\S/g, function(a) { return a.toUpperCase(); });
};

// Run every 5 minutes to ensure states are in sync. Send extended format status queries to extract active & level (dimmer) status from the network. Iterate through all 255 groups 
function regularSync() {
    sendSerial(syncMMI[0].syncMsg)
    setTimeout(regularSync, 900000)
}

// Simple async queue for sending & throttles the send rate if multiple messages on the queue
var queueTimer, lastSent;
function sendSerial(msg) {
    if (msg !== undefined) {
        sendQ.push(msg)                         // If a message is specified, push it on the queue for immediate send          
        clearTimeout(queueTimer)                // Reset the loop timer
    } 
    if (sendReady) {                            // Wait for acknowledgement from last message sent before sending next message
        //fw.log("Sending to CBUS: " + sendQ[0])
        lastMsg = sendQ[0];
        serialCBUS.write(sendQ.shift() + CR, function () {
            //serialCBUS.drain(function () { console.log("written")});
        });   // Take FIFO item off the queue and send it.
        lastSent = (new Date()).valueOf()
    } else {
        if ((new Date()).valueOf() - lastSent > 1000) sendReady = true;                  // Timeout didn't receive ack from CBUS, reset ready flag 
        fw.log("Not ready to send, queued: " + sendQ.length);                           // If getting lots of these usually a network problem
    }
    if (sendQ.length > 0) queueTimer = setTimeout(sendSerial, SEND_THROTTLE)    // Still stuff to send, loop with no new message to send old messages
}

// Checksum is all bytes added (DEC 61 = Hex 05 + Hex 38) with 2's compliment + 1
function checkchkSum(msg) {
        var addchkSum = 0
        var ascii
        if (msg.substr(0,2) === "g.") return true                       // Success acknowledgement
        for (var lp = 0; lp < msg.length; lp++) {           // Check that we have hex ascii characters, reject everything else
            ascii = msg.charCodeAt(lp)
            if (ascii < 48 || ascii > 57) {                 // 1 to 9
                if (ascii < 65 || ascii > 70) return false  // A to F
            }
        }
        try {
            for (var pairLp = 0; pairLp < msg.length; pairLp = pairLp + 2) {        // Check each hex string pair
                addchkSum = addchkSum + parseInt("0x" + msg.substr(pairLp, 2))      // Convert each hex string pair to hex and add up 
            }
            if (addchkSum % 256 === 0) {                    // Adding up all the hex pairs including checksum will always end up with the result % 256 = 0
                return true
            } else {
                return false
            }
        } catch (err) {
            return false
        }
}

// Handle lower level communications to CBUS. (see http://training.clipsal.com/downloads/OpenCBus/Serial%20Interface%20User%20Guide.pdf)
function sendCBUS(grpNum, newVal, rampTime) {
// Format for send: <Header><Application><Options><function><group><chksum>g<cr>. All done in ASCII strings representing hex (eg. "05" = Hex 05), ending with a 'g' to request an acknowledge and <cr> (ASC 13) to finish
// <Header> = "05" always, <Application> = "38" for lighting, <options> = 0 always, <function> = "79" for ON, "01" for OFF, see below for RAMP
// Receive: <Header><originator address><Application><Options><function><group><chksum>g<cr>. Same as send except originator is the source ID and can be ignored
// Ramp to level: \053800rrggttzzc<cr>, tt = hex string for level to ramp to, gg is the group address, zz = checksum, c = confirmation char (lower case g), 
// rr = $02 Instantaneous ramp level
// $0A 4 s ramp rate from min to max or max to min
// $12 8 s ramp rate from min to max or max to min
// $1A 12 s ramp rate from min to max or max to min
// $22 20 s ramp rate from min to max or max to min

    var cmdStr
    var chkSum

    grpNum = parseInt(grpNum)
    rampTime = parseInt(rampTime)
    cmdStr = "\\05" + CBUSApp + "00"                                              // Header constant bytes (38 = lighting application)
    var setVal = parseInt(newVal * 2.5501)                          // Convert to 0 - 255 range and add a little more to ensure integer is rounded down properly
    grpStates[grpNum].level = setVal                                                              // Update in memory database

    fw.toHost(grpStates[grpNum].name, "VALUE", parseInt(grpStates[grpNum].level / 2.5499))
    
    if ((setVal > 0 && setVal < 255) || (rampTime !== 0)) {         // if not ON or OFF levels,) if we are using a dimmer
        if (rampTime < 3) {
            cmdStr = cmdStr + "02"      // Instantaneous
            if (grpNum < 16) {cmdStr = cmdStr + "0" + grpNum.toString(16).toUpperCase() } else {cmdStr = cmdStr + grpNum.toString(16).toUpperCase()}
            if (setVal < 16) {cmdStr = cmdStr + "0" + setVal.toString(16).toUpperCase()} else {cmdStr = cmdStr + setVal.toString(16).toUpperCase()} // Convert to hex strings
            chkSum = (~((0x5 + 0x38 + 0x0 + 0x2 + setVal + grpNum) % 256) & 0xFF) + 1        // Checksum is all bytes added (DEC 63 = Hex 05 + Hex 38 + Hex 02) with 2's compliment + 1
        }
        if ((rampTime >= 3) && (rampTime < 7)) {
            cmdStr = cmdStr + "0A"      // 4 seconds
            if (grpNum < 16) { cmdStr = cmdStr + "0" + grpNum.toString(16).toUpperCase()} else {cmdStr = cmdStr + grpNum.toString(16).toUpperCase()}
            if (setVal < 16) { cmdStr = cmdStr + "0" + setVal.toString(16).toUpperCase()} else {cmdStr = cmdStr + setVal.toString(16).toUpperCase()} // Convert to hex strings
            chkSum = (~((0x5 + 0x38 + 0x0 + 0xA + setVal + grpNum) % 256) & 0xFF) + 1        // Checksum is all bytes added (DEC 71 = Hex 05 + Hex 38 + Hex 0A) with 2's compliment + 1
        }
        if (rampTime > 6) {             // 8 seconds
            cmdStr = cmdStr + "12"      // Anything else do a slow 4 second ramp up (anything more doesn't make sense)
            if (grpNum < 16) { cmdStr = cmdStr + "0" + grpNum.toString(16).toUpperCase()} else {cmdStr = cmdStr + grpNum.toString(16).toUpperCase()}
            if (setVal < 16) { cmdStr = cmdStr + "0" + setVal.toString(16).toUpperCase()} else {cmdStr = cmdStr + setVal.toString(16).toUpperCase()} // Convert to hex strings
            chkSum = (~((0x5 + 0x38 + 0x0 + 0x12 + setVal + grpNum) % 256) & 0xFF) + 1        // Checksum is all bytes added (DEC 79 = Hex 05 + Hex 38 + Hex 12) with 2's compliment + 1
        }

        fw.log("Sending to: " + grpStates[grpNum].name + " (Address: " + grpNum + ") RAMP TO " + setVal + " (Time: " + rampTime + ")")
    } else {           // Not dimmer so must be ON/OFF
        if (setVal === 0) {               // Turn OFF
            fw.log("Sending to: " + grpStates[grpNum].name + " (Address: " + grpNum + ") OFF")
            setVal = 1                  // ON/OFF, set to OFF command
            if (setVal < 16) { cmdStr = cmdStr + "0" + setVal.toString(16).toUpperCase()} else {cmdStr = cmdStr + setVal.toString(16).toUpperCase()} // Convert to hex strings
            if (grpNum < 16) { cmdStr = cmdStr + "0" + grpNum.toString(16).toUpperCase()} else {cmdStr = cmdStr + grpNum.toString(16).toUpperCase()}
            chkSum = (~((0x5 + 0x38 + 0x0 + setVal + grpNum) % 256) & 0xFF) + 1        // Checksum is all bytes added (DEC 61 = Hex 05 + Hex 38) with 2's compliment + 1
        }
        if (setVal === 255) {             // Turn ON
            fw.log("Sending to: " + grpStates[grpNum].name + " (Address: " + grpNum + ") ON")
            setVal = 121                //ON/OFF, set to ON command
            if (setVal < 16) { cmdStr = cmdStr + "0" + setVal.toString(16).toUpperCase()} else {cmdStr = cmdStr + setVal.toString(16).toUpperCase()} // Convert to hex strings
            if (grpNum < 16) { cmdStr = cmdStr + "0" + grpNum.toString(16).toUpperCase()} else {cmdStr = cmdStr + grpNum.toString(16).toUpperCase()}
            chkSum = (~((0x5 + 0x38 + 0x0 + setVal + grpNum) % 256) & 0xFF) + 1        // Checksum is all bytes added (DEC 61 = Hex 05 + Hex 38) with 2's compliment + 1
        }
    }
    if (chkSum < 16) { cmdStr = cmdStr + "0" + chkSum.toString(16).toUpperCase()} else {cmdStr = cmdStr + chkSum.toString(16).toUpperCase()} // Add a leading '0' if we are less than 0x10

    //sendSerial(cmdStr + CR);                // Send twice to ensure command is received, sometimes the first command is lost
    sendSerial(cmdStr + "g" + CR);          // Add 'g' to get the result of the command back from the PCI
    sendReady = false;                      // Wait for acknowledgement before sending again
}

// Serial port receive handler, receive MMI messages (entire 256 node state) or individual changes ("05")
// Receive: <Header><originator address><Application><Options><function><group><chkSum><cr>. Same as send except originator is the source ID and can be ignored
// Confirmation received after the 'g': "." success, "!" checksum fail, "#" too many retransmissions, "$" transmission failed, "%" no system clock. eg. "g." = success
function serialRecv(data) {
        var sourceAddr, hexByte, grp, func

        if (data.length > 0) {
            //fw.log("received CBUS Msg: " + data);
            var msg = data.toString().split(CR)  
        
            for (var msgIndex in msg) {
                msg[msgIndex] = msg[msgIndex].trim();

                if (msg[msgIndex].length > 1) {                                             // Reject spurious characters

                    if (checkchkSum(msg[msgIndex]) === false) {                             // Check checksum & for valid hex characters for each message
                        if (MMISync === 255) fw.log("Incorrect CheckSum received in message: " + msg[msgIndex]); // Only after initialization
                    } else {
                        switch (msg[msgIndex].substr(0, 2)) {
                            case "05":
                                sourceAddr = parseInt("0x" + msg[msgIndex].substr(2, 2))    // Unit that generated the message
                                grp = parseInt("0x" + msg[msgIndex].substr(10, 2))          // Destination group number
                                func = parseInt("0x" + msg[msgIndex].substr(8, 2))          // Lighting level (or ramp time if its a ramp message)
                                switch (func) {                                             // Check the lighting level
                                    case 121:               // Hex 79 - ON
                                        grpStates[grp].level = 255
                                        fw.log("Received: " + grpStates[grp].name + " (" + grp + ") Function: ON")
                                        fw.toHost(grpStates[grp].name, "value", "100")
                                        break;
                                    case 1:                 // OFF
                                        grpStates[grp].level = 0
                                        fw.log("Received: " + grpStates[grp].name + " (" + grp + ") Function: OFF")
                                        fw.toHost(grpStates[grp].name, "value", "0")
                                        break;
                                    default:                // Func will be the ramp timing <> 121 or 1. 
                                        // Ramp to level: 053800rrggttzz<cr>, tt = hex string for level to ramp to, gg is the group address, zz = checksum 
                                        func = parseInt("0x" + msg[msgIndex].substr(12, 2))
                                        grpStates[grp].level = func
                                        fw.log("Received: " + grpStates[grp].name + " (" + grp + ") Function: RAMP to " + func)
                                        fw.toHost(grpStates[grp].name, "value", parseInt(func / 2.5499))
                                }
                                break;

                            case "D8":
                            case "D6":                      // MMI network state information, use to sync state for in-memory database for all addresses
                                break;

                            case "F9":// Extended MMI network state information including ramp levels for dimmers
                            case "F7":
                                var pairCnt = parseInt("0x" + msg[msgIndex].substr(6, 2))       // Starting group number that applies to following data bytes

                                for (var pairLp = 8; pairLp <= msg[msgIndex].length - 3; pairLp = pairLp + 4) {         // Capture two pairs for each level, ignore checksum at the end
                                    if (msg[msgIndex].substr(pairLp, 4) === "0000") {           // Not active
                                        grpStates[pairCnt].active = false
                                    } else {
                                        grpStates[pairCnt].active = true
                                        hexByte = 0
                                        for (var hexLp = 1; hexLp >= 0; hexLp = hexLp - 1) {            // Parse each hex nibble and convert CBUS nibble code to a number (see CBUS protocol user guide pg 48)
                                            switch (msg[msgIndex].substr(pairLp + (hexLp * 2), 2)) {    // Get first pair,) { get second pair
                                                case "55":                      // decode nibble code to value for level (last nibble = MSB)
                                                    hexByte = hexByte + (240 * hexLp) - (hexLp - 1) * 15
                                                    break;
                                                case "56":
                                                    hexByte = hexByte + (224 * hexLp) - (hexLp - 1) * 14
                                                    break;
                                                case "59":
                                                    hexByte = hexByte + (208 * hexLp) - (hexLp - 1) * 13
                                                    break;
                                                case "5A":
                                                    hexByte = hexByte + (192 * hexLp) - (hexLp - 1) * 12
                                                    break;
                                                case "65":
                                                    hexByte = hexByte + (176 * hexLp) - (hexLp - 1) * 11
                                                    break;
                                                case "66":
                                                    hexByte = hexByte + (160 * hexLp) - (hexLp - 1) * 10
                                                    break;
                                                case "69":
                                                    hexByte = hexByte + (144 * hexLp) - (hexLp - 1) * 9
                                                    break;
                                                case "6A":
                                                    hexByte = hexByte + (128 * hexLp) - (hexLp - 1) * 8
                                                    break;
                                                case "95":
                                                    hexByte = hexByte + (112 * hexLp) - (hexLp - 1) * 7
                                                    break;
                                                case "96":
                                                    hexByte = hexByte + (96 * hexLp) - (hexLp - 1) * 6
                                                    break;
                                                case "99":
                                                    hexByte = hexByte + (80 * hexLp) - (hexLp - 1) * 5
                                                    break;
                                                case "9A":
                                                    hexByte = hexByte + (64 * hexLp) - (hexLp - 1) * 4
                                                    break;
                                                case "A5":
                                                    hexByte = hexByte + (48 * hexLp) - (hexLp - 1) * 3
                                                    break;
                                                case "A6":
                                                    hexByte = hexByte + (32 * hexLp) - (hexLp - 1) * 2
                                                    break;
                                                case "A9":
                                                    hexByte = hexByte + (16 * hexLp) - (hexLp - 1)
                                                    break;
                                                case "AA":
                                                    break;
                                                default:
                                            }
                                        }
                                        if (grpStates[pairCnt].level !== hexByte) {                     // Only send changes
                                            grpStates[pairCnt].level = hexByte
                                            fw.toHost(grpStates[pairCnt].name, "value", parseInt(hexByte / 2.5499), true);             // log MMI messages
                                        }
                                    }
                                    pairCnt = pairCnt + 1
                                }

                                MMISync = pairCnt - 1                               // Keep Sync flag with the number of group addresses updated
                                if (MMISync === syncMMI[MMILp].syncRecv) {          // Have we received the correct state from CBUS?
                                    MMILp = MMILp + 1
                                    if (MMILp === syncMMI.length) {                 // End of sync messages
                                        MMILp = 0                                   // Reset counter for next sync
                                    } else {
                                        sendSerial(syncMMI[MMILp].syncMsg)          // Send next sync message
                                    }
                                }
                                break;

                            case "~@":
                                break;
                            case "~~":
                                break;
                            case "A~":
                                break;
                            case "32":
                                break;
                            case "86":                          // Echoed control characters or acknowledge, ignore
                                break;
                            case "g.":                          // Command response
                                sendReady = true;                               // Got a response, so prepare to send next item on work queue
                                if (msg[msgIndex].length === 3) {               // Error response
                                    switch (msg[msgIndex].substr(2, 1)) {
                                        case "!":
                                            fw.log("Command failed - command checksum incorrect")
                                            break;
                                        case "#":
                                            fw.log("Command failed - no specific reason")
                                            break;
                                        case "$":
                                            fw.log("Command failed - no system clock")
                                            break;
                                        case "%":
                                            fw.log("Command failed - no system clock")
                                            break;
                                        default:
                                            fw.log("Do not understand header in message: " + msg[msgIndex])
                                    }
                                    sendSerial(lastMsg)             // Try again
                                } else {
                                    fw.log("Command success acknowledged")
                                }
                                break;
                            default:  
                                fw.log("Do not understand header in message: " + msg[msgIndex])
                        }
                    }
                }
            }
        }
}

// Process host messages
function fromHost(channel, scope, data) {
    switch (scope.toUpperCase()) {
        case "CMD":                  // command
                if (data === "ALLOFF") {
                    for (var lp=0; lp<256; lp++) {
                        if (grpStates[lp].level > 0 && grpStates[lp].watts > 0) {
                            fw.log("Turning off " + grpStates[lp].name)
                            sendCBUS(lp, 0, 0)             // Turn off all lights that are on
                        }
                    }
                }
            break;

        case "VALUE":                  // light state change message echo
            break;

        case "ACTION":
            for (var lp=0; lp < grpStates.length; lp++) {
                if (channel.toLowerCase() === grpStates[lp].name.toLowerCase()) {
                    var getParams = data.split(" ")
                    var getRamp = 0
                    if (getParams.length === 2) getRamp = getParams[1]
                    sendCBUS(lp, getParams[0], getRamp)
                }
            }
            break;

        default:
    }
    return "OK"
}

// Shutdown the plugin. Insert any orderly shutdown code needed here
function shutPlugin(param) {
    serialCBUS.close();
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
            fw.addChannel = function (name, desc, type, io, min, max, units, attribs, value, store) { process.send({ func: "addch", cat: fw.cat, name: fw.plugName, channel: name, scope: desc, data: { type: type, io: io, min: min, max: max, units: units, attribs: attribs, value: value, store: store }}); };
            fw.writeIni = function (section, subSection, key, value) { process.send({ func: "writeini", cat: fw.cat, name: fw.plugName, data: { section: section, subSection: subSection, key: key, value: value }}); };
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

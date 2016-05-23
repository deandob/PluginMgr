"use strict";
// WS2300 La Crosse Weather Station parser, based on protocol described here: http://www.lavrsen.dk/foswiki/bin/view/Open2300/OpenWSMemoryMap, http://www.lavrsen.dk/foswiki/bin/view/Open2300/OpenWSAPI
// Some code adopted from https://github.com/wezm/open2300
// Flow: Send command bytes to read a memory addess one by one and check each returning value checksum. Once command sent successfully, station sends back data bytes.

var serial = require("serialport").SerialPort
var serialPort;
var sendQ = [];
var MSG_TIMEOUT = 500;
var CHANNEL_GAP = 1000;
var ERROR_GAP = 100;
var sendReady = true;
var currMsg = "";
var lastSent;

// GLOBALS FOR WEATHER PLUGIN
var rainRate = -99;
var rainDaily = -99
var raining, windy;
var windCnt = 0;                    
var speedHist = [-1,-1,-1,-1,-1,-1], dirHist = [-1,-1,-1,-1,-1,-1];
var oldData = 0;
var indoorHumidity = -99, outdoorHumidity = -99, indoorTemp = -99, outdoorTemp = -99, pressure = -99, pressTrend = "", prediction = "", totalRain = -99, gustSpeed = -99
var gustDir = "", avgSpeed, avgDir = "", chillOutdoorCurrent = -99, dewPtOutdoorCurrent = -99;
var channel = 0
var retSum = "";
var bytesToRecv = 0;
var recvBuff = new Buffer(10);
var recvCnt = 0;
var cmdDataTimer;
var queueTimer;
var nextChTimer;
var retryTimer;
var retries = 0;
var directions = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"]; 

// startup function
function startup() {
    serialPort = new serial(fw.settings.serialport, {
        baudrate: parseInt(fw.settings.serialbaud),
        databits: parseInt(fw.settings.serialdatabits),
        stopbits: parseInt(fw.settings.serialstopbits),
        parity: fw.settings.serialparity
        }, true, function(result) {
            if (result !== undefined) {
                return "Serial port open error: " + result
            }
    });

    serialPort.on("data", recvData)
    serialPort.on("error", function (err) {
        fw.log("ERROR - General serial port error: " + err);
        fw.restart(99);
    });
    serialPort.on("open", function () {
        fw.log("Serial port open on " + fw.settings.serialport);
        initialize();
        sendChCommand(0)
    });
       
    return "OK"                                 // Return 'OK' only if startup has been successful to ensure startup errors disable plugin
}

// Poll the weather station by sending commands to retrieve data for the revelant channel
function sendChCommand(myChannel) {
    retSum = "";
    bytesToRecv = 0;
    channel = myChannel;

    if (!channelSettingsOK()) {
        clearTimeout(nextChTimer);
        nextChTimer = setTimeout(nextChannel, CHANNEL_GAP);
        return;
    }

    var encAdd = address_encoder(+fw.channels[channel].attribs[0].value);       // get command code for channel and encode. First 4 bytes are populated with converted address range 0000-13B0
    for (var i = 0; i < 4; i++) {
        sendSerial(encAdd[i], command_check0123(encAdd[i], i), 0)
    }
    
    // Last populate the 5th byte with the converted number of bytes being sent
    sendSerial(numberof_encoder(+fw.channels[channel].attribs[1].value), command_check4(+fw.channels[channel].attribs[1].value), 0)   
}

// Once the current value being retrieved is successful, move onto the next data value to retrieve.
function nextChannel() {
    retries = 0;

    initialize();

    if (fw.channels.length - 1 === channel) {
        setTimeout(sendChCommand, +fw.settings.pollinterval * 1000, 0);   // Wait before restarting poll cycle
    } else {
        sendChCommand(channel + 1);                                      // get the next weather value
    }
}

function recvData(data) {
    if (fw.settings.debug) fw.log(new Date().getSeconds() + ":" + new Date().getMilliseconds() + " received: " + data);
    clearTimeout(queueTimer);                                  // have received something from the last message, so reset command response
    for (var i = 0; i < data.length; i++) {
        if (bytesToRecv !== 0) {                        // receiving channel data
            recvBuff[recvCnt] = data[i];
            recvCnt = recvCnt + 1;
            bytesToRecv = bytesToRecv - 1;

            if (bytesToRecv === 0) {
                clearTimeout(cmdDataTimer);                   // Got back all the data I was expecting

                if (data_checksum(recvBuff, fw.channels[channel].attribs[1].value) === +recvBuff[fw.channels[channel].attribs[1].value]) {
                    sendReady = true;
                    processResult();
                } else {
                    if (fw.settings.debug) fw.log("WARNING - Incorrect checksum in channel data response: " + fw.channels[channel].name + ". Retrying command")
                    clearTimeout(retryTimer);
                    retryTimer = setTimeout(retryChannel, ERROR_GAP);
                    return;
                }
            }
        } else {                                // receiving responses to command bytes
            if (sendReady === true) {                   // I'm not waiting on a response, so ignore it
                if (fw.settings.debug) fw.log(new Date().getSeconds() + ":" + new Date().getMilliseconds() + " received: " + data[0] + " but not expecting anything. Ignoring");
                clearTimeout(retryTimer);
                retryTimer = setTimeout(retryChannel, ERROR_GAP);
                return;
            }
            sendReady = true;

            if (currMsg !== undefined) {                                                        // No more messages to send if undefined
                if (Number(data[i]) === Number(currMsg.result)) {                               // is the command byte received the expected result?
                    if (fw.settings.debug) fw.log(new Date().getSeconds() + ":" + new Date().getMilliseconds() + " recv true: " + data[0])
                    retSum = retSum + data[i].toString()
                    
                    if (retSum === "2") retSum = "";                            // reset
                    if (channelSettingsOK()) if (retSum === fw.channels[channel].attribs[2].value) {
                        // we have received all the correct responses for command bytes, so now prepare to receive the command result data
                        bytesToRecv = +fw.channels[channel].attribs[1].value + 1
                        recvCnt = 0;
                        clearTimeout(cmdDataTimer);
                        cmdDataTimer = setTimeout(dataTimeout, MSG_TIMEOUT);
                        if (fw.settings.debug) fw.log("Command response for " + fw.channels[channel].name + " received. Looking for data response....")
                        //if (fw.channels[channel].name === "Daily Rain") fw.settings.debugger
                    }
                } else {
                    if (fw.settings.debug) fw.log("WARNING - Channel " + fw.channels[channel].name + " received wrong command response: " + data[i] + ", expecting " + Number(currMsg.result) + ". Retrying command")
                    clearTimeout(retryTimer);
                    retryTimer = setTimeout(retryChannel, ERROR_GAP);      // ws2300 serial isn't high priority so if get bad response let it finish what it is doing first
                    return;
                }
                sendSerial();                           // send next byte
            } else {
                if (fw.settings.debug) fw.log("WARNING - Command result '" + retSum + "' isn't the right command response for: " + fw.channels[channel].name + ". Retrying command");
                clearTimeout(retryTimer);
                retryTimer = setTimeout(retryChannel, ERROR_GAP);
                return;
            }
        }        
    }
}

// initialise and retry channel
function retryChannel() {
    retries = retries + 1;
    initialize();

    if (retries < 10) {
        sendChCommand(channel);                
    } else {
        fw.log("WARNING - Too many retries for: " + fw.channels[channel].name + ". Skipping channel...");
        clearTimeout(nextChTimer);
        nextChTimer = setTimeout(nextChannel, ERROR_GAP);                          // Give up on this channel
    }
 }

// Didn't receive responses to a command byte sent.
function dataTimeout() {
    if (fw.settings.debug) fw.log("WARNING - Timeout receiving data for " + fw.channels[channel].name + ". Retrying channel...")
    retryChannel();    
}

// Check that the settings file is setup OK
function channelSettingsOK() {
    if (fw.channels[channel] === undefined || fw.channels[channel].attribs[0] === undefined || fw.channels[channel].attribs[1] === undefined || fw.channels[channel].attribs[2] === undefined) {
        if (fw.channels[channel].attribs.length !== 0) fw.log("WARNING - Settings for channel " + fw.channels[channel].name + " are incorrect. Skipping channel...")
        return false;            // settings not correct
    } else return true;
}

// Simple async queue for sending & throttles the send rate if multiple messages on the queue
function sendSerial(msgArr, result, retries) {
    var msgObj = { "msg": msgArr, "result" : result, "retries" : retries }

    if (msgArr !== undefined) {
        //debugger
        sendQ.push(msgObj)                                          // If a message is specified, push it on the queue for immediate send          
    }
    if (sendReady) {                                                // Wait for acknowledgement from last message sent before sending next message
        currMsg = sendQ.shift();                                    // save if retries needed
        if (currMsg === undefined) return;                          // no more to send
        sendPort(currMsg.msg)                                       // send array through serial as bytes
        sendReady = false;                // wait for the response before sending more
    } 
}

// Low level send buffer out serial port
function sendPort(sendArr) {
    if (!Array.isArray(sendArr)) sendArr = [sendArr];               // Always work on arrays
    var buf = new Buffer(sendArr.length);
    for (var i in sendArr) buf.writeUInt8(sendArr[+i], +i);

    if (fw.settings.debug) fw.log(new Date().getSeconds() + ":" + new Date().getMilliseconds() + " sent: " + sendArr)
    serialPort.write(buf, function () {
        lastSent = sendArr;
        clearTimeout(queueTimer);
        queueTimer = setTimeout(respTimeout, MSG_TIMEOUT)       // Timeout if we don't get a response
//        serialPort.drain(function () {                              // When send is completed
//        });
    }); 
}

// Didn't receive responses to a command byte sent.
function respTimeout() {
    if (fw.settings.debug) fw.log("WARNING - Timeout receiving response for request '" + lastSent + "'. Retrying request...")
    retryChannel();
    //sendPort(lastSent)                                       // send array through serial as bytes
}


// initialize resets WS2300 to cold start (rewind and start over) as well as serial state machine status & counters. Occasionally 0, then 2 is returned.
function initialize() {
    sendQ = [];                // reset send queue
    retSum = "";
    bytesToRecv = 0;
    sendReady = true;
    clearTimeout(cmdDataTimer);
    clearTimeout(queueTimer);
    clearTimeout(nextChTimer);
    clearTimeout(retryTimer);

    for (var i = 0; i < 2; i++) sendSerial([0x06], 0x02, 10)             // send 2 6's initially which resets the station & rewinds to data start
}

// address_encoder converts an 16 bit address to the form needed by the WS-2300 when sending commands. 3 bytes character array, not zero terminated.
function address_encoder(address_in) {
    var nibble;
    var address_out = [];
    
    for (var i = 0; i < 4; i++) {
        nibble = (address_in >> (4 * (3 - i))) & 0x0F;
        address_out[i] = (0x82 + (nibble * 4));
    }
    
    return address_out;
}
// numberof_encoder converts the number of bytes we want to read to the form needed by the WS-2300 when sending commands.Input number max value 15, returns string which is the coded number of bytes
function numberof_encoder(number) {
    var coded_number;
    
    coded_number = (0xC2 + number * 4);
    if (coded_number > 0xfe) coded_number = 0xfe;
    return coded_number;
}

// command_check0123 calculates the checksum for the first 4 commands sent to WS2300. Input: character string, sequence of command - i.e. 0, 1, 2 or 3. Returns calculated checksum
function command_check0123(command, sequence) {    
    return sequence * 16 + (command - 0x82) / 4;
}

// command_check4 calculates the checksum for the last command which is sent just before data is received from WS2300. Input number of bytes requested. 
// Returns expected response from requesting number of bytes
function command_check4(number) {
	return 0x30 + number;
}

// data_checksum calculates the checksum for the data bytes received from the WS2300. Input array of data to check number of bytes in array. Returns calculated checksum
function data_checksum(data, number) {
	var checksum = 0;
	for (var i = 0; i < number; i++) checksum += data[i];
	return checksum &= 0xFF;
}

// Convert received data into values to send to host
function processResult() {
    if (fw.settings.debug) fw.log("--> Got data for " + fw.channels[channel].name)
    switch (fw.channels[channel].name) {
        case "Indoor Temperature":
            oldData = indoorTemp;
            if (fw.settings.tempunits.toUpperCase() === "F")
                indoorTemp = Math.round((((((recvBuff[1] >> 4) * 10 + (recvBuff[1] & 0xF) + (recvBuff[0] >> 4) / 10.0 + (recvBuff[0] & 0xF) / 100.0) - 30.0)) * 9 / 5 + 32) * 10) / 10;
            else
                indoorTemp = Math.round(((((recvBuff[1] >> 4) * 10 + (recvBuff[1] & 0xF) + (recvBuff[0] >> 4) / 10.0 + (recvBuff[0] & 0xF) / 100.0) - 30.0)) * 10) / 10;
            if (indoorTemp > oldData) fw.toHost("Indoor Temperature", "C", indoorTemp);
            if (indoorTemp < oldData) fw.toHost("Indoor Temperature", "C", indoorTemp);
            break;

        case "Outdoor Temperature":
            oldData = outdoorTemp;
            if (fw.settings.tempunits.toUpperCase() === "F") {
                outdoorTemp = Math.round((((((recvBuff[1] >> 4) * 10 + (recvBuff[1] & 0xF) + (recvBuff[0] >> 4) / 10.0 + (recvBuff[0] & 0xF) / 100.0) - 30.0)) * 9 / 5 + 32) * 10) / 10;
                if (outdoorTemp > 120) {
                    fw.log("outdoor temperature " + outdoorTemp + " reading is incorrect. Check battery.")
                    break;
                }
            } else {
                outdoorTemp = Math.round(((((recvBuff[1] >> 4) * 10 + (recvBuff[1] & 0xF) + (recvBuff[0] >> 4) / 10.0 + (recvBuff[0] & 0xF) / 100.0) - 30.0)) * 10) / 10;
                if (outdoorTemp > 60) {
                    fw.log("Outdoor temperature " + outdoorTemp + " reading is incorrect. Check battery.")
                    break;
                }
                if (outdoorTemp > oldData) fw.toHost("Outdoor Temperature", "C", outdoorTemp);
                if (outdoorTemp < oldData) fw.toHost("Outdoor Temperature", "C", outdoorTemp);
            }
            break;

        case "Indoor Humidity":
            oldData = indoorHumidity
            indoorHumidity = ((recvBuff[0] >> 4) * 10 + (recvBuff[0] & 0xF));
            if (indoorHumidity > oldData) fw.toHost("Indoor Humidity", "%", indoorHumidity)
            if (indoorHumidity < oldData) fw.toHost("Indoor Humidity", "%", indoorHumidity)
            break;

        case "Outdoor Humidity":
            oldData = outdoorHumidity
            outdoorHumidity = ((recvBuff[0] >> 4) * 10 + (recvBuff[0] & 0xF));
            if (outdoorHumidity > oldData) fw.toHost("Outdoor Humidity", "%", outdoorHumidity)
            if (outdoorHumidity < oldData) fw.toHost("Outdoor Humidity", "%", outdoorHumidity)
            break;

        case "Barometric Pressure":
            oldData = pressure
            pressure = parseInt((((recvBuff[2] & 0xF) * 1000 + (recvBuff[1] >> 4) * 100 + (recvBuff[1] & 0xF) * 10 + (recvBuff[0] >> 4) + (recvBuff[0] & 0xF) / 10.0) / +fw.settings.pressconvfactor));
            if (pressure > oldData) fw.toHost("Barometric Pressure", "bar", pressure)
            if (pressure < oldData) fw.toHost("Barometric Pressure", "bar", pressure)
            break;

        case "Pressure Trend":
            oldData = pressTrend
            if ((recvBuff[0] >> 4) === 1) pressTrend = "Rising"
            if ((recvBuff[0] >> 4) === 0) pressTrend = "Steady"
            if ((recvBuff[0] >> 4) === 2) pressTrend = "Falling"
            if (oldData !== pressTrend) fw.toHost("Pressure Trend", "text", pressTrend)
            oldData = prediction
            if ((recvBuff[0] & 0xF) === 2) prediction = "Sunny"
            if ((recvBuff[0] & 0xF) === 1) prediction = "Cloudy"
            if ((recvBuff[0] & 0xF) === 0) prediction = "Rain"
            if (oldData !== prediction) fw.toHost("Prediction", "text", prediction)
            break;

        case "Outdoor Dew Point":
            oldData = dewPtOutdoorCurrent
            if (fw.settings.tempunits.toUpperCase() === "F")
                dewPtOutdoorCurrent = Math.round(((((recvBuff[1] >> 4) * 10 + (recvBuff[1] & 0xF) + (recvBuff[0] >> 4) / 10.0 + (recvBuff[0] & 0xF) / 100.0) - 30.0) * 9 / 5 + 32));
            else
                dewPtOutdoorCurrent = Math.round(((((recvBuff[1] >> 4) * 10 + (recvBuff[1] & 0xF) + (recvBuff[0] >> 4) / 10.0 + (recvBuff[0] & 0xF) / 100.0) - 30.0)));
            
            if (dewPtOutdoorCurrent > oldData) fw.toHost("Outdoor Dew Point", "C", dewPtOutdoorCurrent)
            if (dewPtOutdoorCurrent < oldData) fw.toHost("Outdoor Dew Point", "C", dewPtOutdoorCurrent)
            break;

        case "Rain Rate":
            oldData = rainRate;
            rainRate = Math.round((((recvBuff[2] >> 4) * 1000 + (recvBuff[2] & 0xF) * 100 + (recvBuff[1] >> 4) * 10 + (recvBuff[1] & 0xF) + (recvBuff[0] >> 4) / 10.0 + (recvBuff[0] & 0xF) / 100.0) / fw.settings.rainconvfactor) * 100) / 100;         // rate per hour
            if (rainRate > oldData) fw.toHost("Rain Rate", "mm/hr", rainRate);
            if (rainRate < oldData) fw.toHost("Rain Rate", "mm/hr", rainRate);
            if (raining !== true && rainRate > 0) {
                fw.toHost("Raining", "started", 1);
                raining = true
            }
            if (raining !== false && rainRate === 0) {
                fw.toHost("Raining", "finished", 0)
                raining = false
            }            
            break;

        case "Daily Rain":
            oldData = rainDaily;
            rainDaily = Math.round((((recvBuff[2] >> 4) * 1000 + (recvBuff[2] & 0xF) * 100 + (recvBuff[1] >> 4) * 10 + (recvBuff[1] & 0xF) + (recvBuff[0] >> 4) / 10.0 + (recvBuff[0] & 0xF) / 100.0) / fw.settings.rainconvfactor) * 100) / 100;         // rate per hour
            if (rainDaily > oldData) fw.toHost("Daily Rain", "mm", rainDaily);
            if (rainDaily < oldData) fw.toHost("Daily Rain", "mm", rainDaily);
            break;

        case "Total Rain":
            oldData = totalRain;
            totalRain = Math.round((((recvBuff[2] >> 4) * 1000 + (recvBuff[2] & 0xF) * 100 + (recvBuff[1] >> 4) * 10 + (recvBuff[1] & 0xF) + (recvBuff[0] >> 4) / 10.0 + (recvBuff[0] & 0xF) / 100.0) / fw.settings.rainconvfactor) * 100) / 100;         // rate per hour
            if (totalRain > oldData) fw.toHost("Total Rain", "mm", totalRain);
            if (totalRain < oldData) fw.toHost("Total Rain", "mm", totalRain);
            break;

        case "Wind Speed":
            if ((recvBuff[0] != 0x00) || ((recvBuff[1] == 0xFF) && (((recvBuff[2] & 0xF) == 0) || ((recvBuff[2] & 0xF) == 1)))) {
                fw.log("WARNING - Invalid wind speed registered. " + recvBuff[0] + "," + recvBuff[1] + "," + recvBuff[2] + " Skipping.")
            } else {
                oldData = gustSpeed
                gustSpeed = Math.round((((recvBuff[2] & 0xF) << 8) + (recvBuff[1])) / 10.0 * fw.settings.windconvfactor)
                if (gustSpeed > oldData) fw.toHost("Wind Speed", "KM/H", gustSpeed)
                if (gustSpeed < oldData) fw.toHost("Wind Speed", "KM/H", gustSpeed)
                if (gustSpeed > 0 && windy !== true) {
                    windy = true
                    fw.toHost("Windy", "started", 1)
                }
                if (gustSpeed === 0 && windy !== false) {
                    windy = false
                    fw.toHost("Windy", "finished", 0)
                }
                
                oldData = gustDir
                gustDir = directions[recvBuff[2] >> 4];
                if (gustDir !== oldData) fw.toHost("Wind Direction", "cardinal", gustDir)
                
                // Calculate average speed and direction from the last 6 entries
                if (windCnt === 6) windCnt = 0;
                speedHist[windCnt] = gustSpeed;
                dirHist[windCnt] = recvBuff[2] >> 4;
                var cntSpeed = 0, cntDir = 0, loopCnt = 0;
                for (var i = 0; i < 6; i++) {
                    if (speedHist[i] !== -1) {                  // ignore unset values when first starting
                        cntSpeed = cntSpeed + speedHist[i];
                        cntDir = cntDir + dirHist[i];
                        loopCnt = loopCnt + 1
                    } 
                }
                oldData = avgSpeed
                avgSpeed = Math.round(cntSpeed / loopCnt)
                if (avgSpeed > oldData) fw.toHost("Average Wind Speed", "KM/H", avgSpeed)
                if (avgSpeed < oldData) fw.toHost("Average Wind Speed", "KM/H", avgSpeed)
                oldData = avgDir
                avgDir = directions[Math.round(cntDir / loopCnt)]
                if (avgDir !== oldData) fw.toHost("Average Wind Direction", "cardinal", avgDir)
                windCnt = windCnt + 1           
            }            
            break;

        case "Outdoor Chill Temperature":
            oldData = chillOutdoorCurrent
            if (fw.settings.tempunits.toUpperCase() === "F")
                chillOutdoorCurrent = Math.round(((((recvBuff[1] >> 4) * 10 + (recvBuff[1] & 0xF) + (recvBuff[0] >> 4) / 10.0 + (recvBuff[0] & 0xF) / 100.0) - 30.0) * 9 / 5 + 32));
            else
                chillOutdoorCurrent = Math.round(((((recvBuff[1] >> 4) * 10 + (recvBuff[1] & 0xF) + (recvBuff[0] >> 4) / 10.0 + (recvBuff[0] & 0xF) / 100.0) - 30.0)));
            if (chillOutdoorCurrent > oldData) fw.toHost("Outdoor Chill Temperature", "C", chillOutdoorCurrent)
            if (chillOutdoorCurrent < oldData) fw.toHost("Outdoor Chill Temperature", "C", chillOutdoorCurrent)
            break;
        default:
            fw.log("WARNING - Channel '" + fw.channels[channel].name + "' isn't defined, check settings file.")
    }
    nextChannel();
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
exports.loaded = function(iniCat, iniName, iniChannels, iniSettings, iniStore) {
    fw.cat = iniCat;
    fw.plugName = iniName;
    fw.channels = iniChannels;
    fw.settings = iniSettings;
    fw.store = iniStore;
    fw.restart = function (code) { module.parent.exports.restart(code) };
    fw.log = function (msg) { module.parent.exports.log(fw.cat + "/" + fw.plugName, msg) };
    fw.toHost = function (myChannel, myScope, myData, myLog) { module.parent.exports.toHost(fw.cat, fw.plugName, myChannel, myScope, myData, myLog) };
    fw.addChannel = function (name, desc, type, io, min, max, units, attribs, value, store) {module.parent.exports.addChannel(fw.cat, fw.plugName, name, desc, type, io, min, max, units, attribs, value, store)};
    return startup();
}


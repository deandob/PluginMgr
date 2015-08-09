"use strict";
// WS2300 La Crosse Weather Station parser, based on protocol described here: http://www.lavrsen.dk/foswiki/bin/view/Open2300/OpenWSMemoryMap, http://www.lavrsen.dk/foswiki/bin/view/Open2300/OpenWSAPI
// Some code adopted from https://github.com/wezm/open2300
// Flow: Send command bytes to read a memory addess one by one and check each returning value checksum. Once command sent successfully, station sends back data bytes.
var serial = require("serialport").SerialPort
var serialPort;
var sendQ = [];
var MSG_TIMEOUT = 150;
var sendReady = true;
var currMsg = ""

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
var cycle = true;
var retSum = "";
var bytesToRecv = 0;
var recvBuff = new Buffer(10);
var recvCnt = 0;
var cmdDataTimeout;
var queueTimer
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

    serialPort.on("open", function () {
        fw.log("Serial port open on " + fw.settings.serialport);
        retryChannel();        
    });
    serialPort.on("data", recvData)
    serialPort.on("error", function (err) {
        fw.log("ERROR - General serial port error: " + err);
    });
       
    return "OK"                                 // Return 'OK' only if startup has been successful to ensure startup errors disable plugin
}

// Poll the weather station by sending commands to retrieve data for the revelant channel
function sendCommand(myChannel, myCycle) {
    retSum = "";
    bytesToRecv = 0;
    channel = myChannel;

    if (myCycle !== undefined) cycle = myCycle;                             // one off command (false) or cycle through all commands in settings (true)

    if (!channelSettingsOK()) {
        nextChannel();
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

    if (cycle = true) {
        initialize();

        if (fw.channels.length - 1 === channel) {
            setTimeout(sendCommand, fw.settings.pollinterval * 1000, 0);   // Wait before restarting poll cycle
        } else {
            sendCommand(channel + 1);                                      // get the next weather value
        }
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
                clearTimeout(cmdDataTimeout);                   // Got back all the data I was expecting

                if (data_checksum(recvBuff, fw.channels[channel].attribs[1].value) === +recvBuff[fw.channels[channel].attribs[1].value]) {
                    processResult();
                } else {
                    if (fw.settings.debug) fw.log("WARNING - Incorrect checksum in channel data response: " + fw.channels[channel].name + ". Retrying command")
                    retryChannel();
                }
            }
        } else {                                // receiving responses to command bytes
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
                        clearTimeout(cmdDataTimeout)
                        cmdDataTimeout = setTimeout(dataTimeout, MSG_TIMEOUT)
                        if (fw.settings.debug) fw.log("Command response for " + fw.channels[channel].name + " received. Looking for data response....")
                        //if (fw.channels[channel].name === "Daily Rain") fw.settings.debugger
                    }
                } else {
                    if (fw.settings.debug) fw.log("WARNING - Channel " + fw.channels[channel].name + " received wrong command response: " + data[i] + ", expecting " + Number(currMsg.result) + ". Retrying command")
                    retryChannel();
                }
                sendSerial();                           // send next byte
            } else {
                if (fw.settings.debug) fw.log("WARNING - Command result '" + retSum + "' isn't the right command response for: " + fw.channels[channel].name + ". Retrying command");
                retryChannel();
                break;
            }
        }        
    }
}

// initialise and retry channel
function retryChannel() {
    retries = retries + 1;
    initialize();

    if (retries < 10) {
        sendCommand(channel);                
    } else {
        fw.log("WARNING - Too many retries for: " + fw.channels[channel].name + ". Skipping channel...");
        nextChannel();                          // Give up on this channel
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

    serialPort.write(buf, function () {
        serialPort.drain(function () {                              // When send is completed
            if (fw.settings.debug) fw.log(new Date().getSeconds() + ":" + new Date().getMilliseconds() + " sent: " + sendArr)
            clearTimeout(queueTimer);
            queueTimer = setTimeout(dataTimeout, MSG_TIMEOUT)       // Timeout if we don't get a response
        });
    }); 
}

// initialize resets WS2300 to cold start (rewind and start over) as well as serial state machine status & counters. Occasionally 0, then 2 is returned.
function initialize() {
    sendQ = [];                // reset send queue
    retSum = "";
    bytesToRecv = 0;
    sendReady = true;

    for (var i = 0; i < 5; i++) sendSerial([0x06], 0x02, 10)             // send 2 6's initially which resets the station & rewinds to data start
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
    if (fw.settings.debug) fw.log("Got data for " + fw.channels[channel].name)

    switch (fw.channels[channel].name) {
        case "Indoor Temperature":
            oldData = indoorTemp;
            if (fw.settings.tempunits.toUpperCase() === "F")
                indoorTemp = Math.round((((((recvBuff[1] >> 4) * 10 + (recvBuff[1] & 0xF) + (recvBuff[0] >> 4) / 10.0 + (recvBuff[0] & 0xF) / 100.0) - 30.0)) * 9 / 5 + 32) * 10) / 10;
            else
                indoorTemp = Math.round(((((recvBuff[1] >> 4) * 10 + (recvBuff[1] & 0xF) + (recvBuff[0] >> 4) / 10.0 + (recvBuff[0] & 0xF) / 100.0) - 30.0)) * 10) / 10;
            if (indoorTemp > oldData) fw.toHost("Indoor Temperature", "value increasing", indoorTemp);
            if (indoorTemp < oldData) fw.toHost("Indoor Temperature", "value decreasing", indoorTemp);
            break;

        case "Outdoor Temperature":
            oldData = outdoorTemp;
            if (fw.settings.tempunits.toUpperCase() === "F")
                outdoorTemp = Math.round((((((recvBuff[1] >> 4) * 10 + (recvBuff[1] & 0xF) + (recvBuff[0] >> 4) / 10.0 + (recvBuff[0] & 0xF) / 100.0) - 30.0)) * 9 / 5 + 32) * 10) / 10;
            else
                outdoorTemp = Math.round(((((recvBuff[1] >> 4) * 10 + (recvBuff[1] & 0xF) + (recvBuff[0] >> 4) / 10.0 + (recvBuff[0] & 0xF) / 100.0) - 30.0)) * 10) / 10;
            if (outdoorTemp > oldData) fw.toHost("Outdoor Temperature", "value increasing", outdoorTemp);
            if (outdoorTemp < oldData) fw.toHost("Outdoor Temperature", "value decreasing", outdoorTemp);
            break;

        case "Indoor Humidity":
            oldData = indoorHumidity
            indoorHumidity = ((recvBuff[0] >> 4) * 10 + (recvBuff[0] & 0xF));
            if (indoorHumidity > oldData) fw.toHost("Indoor Humidity", "value increasing", indoorHumidity)
            if (indoorHumidity < oldData) fw.toHost("Indoor Humidity", "value decreasing", indoorHumidity)
            break;

        case "Outdoor Humidity":
            oldData = outdoorHumidity
            outdoorHumidity = ((recvBuff[0] >> 4) * 10 + (recvBuff[0] & 0xF));
            if (outdoorHumidity > oldData) fw.toHost("Outdoor Humidity", "value increasing", outdoorHumidity)
            if (outdoorHumidity < oldData) fw.toHost("Outdoor Humidity", "value decreasing", outdoorHumidity)
            break;

        case "Barometric Pressure":
            oldData = pressure
            pressure = parseInt((((recvBuff[2] & 0xF) * 1000 + (recvBuff[1] >> 4) * 100 + (recvBuff[1] & 0xF) * 10 + (recvBuff[0] >> 4) + (recvBuff[0] & 0xF) / 10.0) / +fw.settings.pressconvfactor));
            if (pressure > oldData) fw.toHost("Barometric Pressure", "value increasing", pressure)
            if (pressure < oldData) fw.toHost("Barometric Pressure", "value decreasing", pressure)
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
            
            if (dewPtOutdoorCurrent > oldData) fw.toHost("Outdoor Dew Point", "value increasing", dewPtOutdoorCurrent)
            if (dewPtOutdoorCurrent < oldData) fw.toHost("Outdoor Dew Point", "value decreasing", dewPtOutdoorCurrent)
            break;

        case "Rain Rate":
            oldData = rainRate;
            rainRate = Math.round((((recvBuff[2] >> 4) * 1000 + (recvBuff[2] & 0xF) * 100 + (recvBuff[1] >> 4) * 10 + (recvBuff[1] & 0xF) + (recvBuff[0] >> 4) / 10.0 + (recvBuff[0] & 0xF) / 100.0) / fw.settings.rainconvfactor) * 100) / 100;         // rate per hour
            if (rainRate > oldData) fw.toHost("Rain Rate", "value increasing", rainRate);
            if (rainRate < oldData) fw.toHost("Rain Rate", "value decreasing", rainRate);
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
            if (rainDaily > oldData) fw.toHost("Daily Rain", "value increasing", rainDaily);
            if (rainDaily < oldData) fw.toHost("Daily Rain", "value decreasing", rainDaily);
            break;

        case "Total Rain":
            oldData = totalRain;
            totalRain = Math.round((((recvBuff[2] >> 4) * 1000 + (recvBuff[2] & 0xF) * 100 + (recvBuff[1] >> 4) * 10 + (recvBuff[1] & 0xF) + (recvBuff[0] >> 4) / 10.0 + (recvBuff[0] & 0xF) / 100.0) / fw.settings.rainconvfactor) * 100) / 100;         // rate per hour
            if (totalRain > oldData) fw.toHost("Total Rain", "value increasing", totalRain);
            if (totalRain < oldData) fw.toHost("Total Rain", "value decreasing", totalRain);
            break;

        case "Wind Speed":
            if ((recvBuff[0] != 0x00) || ((recvBuff[1] == 0xFF) && (((recvBuff[2] & 0xF) == 0) || ((recvBuff[2] & 0xF) == 1)))) {
                fw.log("WARNING - Invalid wind speed registered. Skipping.")
            } else {
                oldData = gustSpeed
                gustSpeed = Math.round((((recvBuff[2] & 0xF) << 8) + (recvBuff[1])) / 10.0 * fw.settings.windconvfactor)
                if (gustSpeed > oldData) fw.toHost("Wind Speed", "value increasing", gustSpeed)
                if (gustSpeed < oldData) fw.toHost("Wind Speed", "value decreasing", gustSpeed)
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
                if (avgSpeed > oldData) fw.toHost("Average Wind Speed", "value increasing", avgSpeed)
                if (avgSpeed < oldData) fw.toHost("Average Wind Speed", "value decreasing", avgSpeed)
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
            if (chillOutdoorCurrent > oldData) fw.toHost("Outdoor Chill Temperature", "value", chillOutdoorCurrent)
            if (chillOutdoorCurrent < oldData) fw.toHost("Outdoor Chill Temperature", "value", chillOutdoorCurrent)
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
    fw.log = function (msg) { module.parent.exports.log(fw.cat + "/" + fw.plugName, msg) };
    fw.toHost = function (myChannel, myScope, myData) {module.parent.exports.toHost(fw.cat, fw.plugName, myChannel, myScope, myData)};
    fw.addChannel = function (name, desc, type, io, min, max, units, attribs, value, store) {module.parent.exports.addChannel(fw.cat, fw.plugName, name, desc, type, io, min, max, units, attribs, value, store)};
    return startup();
}


"use strict";

var router = require('./Huawei/Huawei');

var token;
var rssi = "";

// Originally from 
// https://blog.hqcodeshop.fi/archives/259-Huawei-E5186-AJAX-API.html
// http://blog.hsp.dk/php-api-huawei-e5180-router/
// https://github.com/ishan-marikar/dialog-router-api

function startup() {
    router = router.create({
        gateway: fw.settings["routerip"]
    });
    routerCmd("getsignal", "", false);
    setInterval(routerCmd, +fw.settings["pollrssi"] * 1000, "getsignal", "", true);       // send RSSI regularly
    return "OK"                                                     // Return 'OK' only if startup has been successful to ensure startup errors disable plugin
}

function routerCmd(func, data, sendIfChanged) {
    router.getToken(function (error, myToken) {
        if (error) fw.log("ERROR - Can't get token from Huawei LTE router, possibly offline? " + error);
        else {
            token = myToken;
            router.login(myToken, fw.settings["username"], fw.settings["password"], function (error, response) {
                //fw.log("Login to Huawei LTE router: " + response);
                if (error) fw.log("ERROR - Can't login to Huawei LTE router, possibly offline? " + error);
                else {
                    switch (func.toLowerCase()) {
                        case "setwifi":
                            setWifi(data);
                            break;
                        case "getsignal":
                            router.getSignalStatus(token, function (error, response) {
                                if (rssi != response.rssi || !sendIfChanged) fw.toHost(fw.channels[1].name, fw.channels[1].units, response.rssi);     // Only send changes or if sent explicit cmd
                                //fw.log("RSSI Signal strength: " + response.rssi);
                                rssi = response.rssi;
                            });
                            break;
                        case "reboot":
                            router.reboot(token, function (error, response) {
                                fw.log("Rebooting Huawei LTE router - response: " + response);
                                if (error) fw.log("ERROR - Can't reboot, error: " + error);
                            });
                            break;
                    }
                }
            });
        }
    });
}

// '<?xml version:"1.0" encoding="UTF-8"?><request><Ssids><Ssid><Index>0</Index><WifiEnable>0</WifiEnable><WifiSsid>vividwireless-66AB</WifiSsid><WifiMac></WifiMac><WifiBroadcast>0</WifiBroadcast><WifiIsolate>0</WifiIsolate><wifi_max_assoc>32</wifi_max_assoc><WifiAuthmode>WPA2-PSK</WifiAuthmode><WifiBasicencryptionmodes>WEP</WifiBasicencryptionmodes><WifiWpaencryptionmodes>AES</WifiWpaencryptionmodes><WifiWepKeyIndex>1</WifiWepKeyIndex><WifiWpsenbl>1</WifiWpsenbl><WifiWpscfg>0</WifiWpscfg><WifiRotationInterval>60</WifiRotationInterval><WifiAssociatedStationNum>0</WifiAssociatedStationNum><wifitotalswitch>1</wifitotalswitch><wifiguestofftime>0</wifiguestofftime></Ssid><Ssid><Index>1</Index><WifiEnable>0</WifiEnable><WifiSsid>vividwireless-66AB-1</WifiSsid><WifiMac></WifiMac><WifiBroadcast>0</WifiBroadcast><WifiIsolate>0</WifiIsolate><wifi_max_assoc>32</wifi_max_assoc><WifiAuthmode>WPA2-PSK</WifiAuthmode><WifiBasicencryptionmodes>WEP</WifiBasicencryptionmodes><WifiWpaencryptionmodes>AES</WifiWpaencryptionmodes><WifiWepKeyIndex>1</WifiWepKeyIndex><WifiWpsenbl>1</WifiWpsenbl><WifiWpscfg>0</WifiWpscfg><WifiRotationInterval>60</WifiRotationInterval><WifiAssociatedStationNum>0</WifiAssociatedStationNum><wifitotalswitch>1</wifitotalswitch><wifiguestofftime>0</wifiguestofftime></Ssid><Ssid><Index>2</Index><WifiEnable>0</WifiEnable><WifiSsid>vividwireless-66AB-2</WifiSsid><WifiMac></WifiMac><WifiBroadcast>0</WifiBroadcast><WifiIsolate>0</WifiIsolate><wifi_max_assoc>32</wifi_max_assoc><WifiAuthmode>WPA2-PSK</WifiAuthmode><WifiBasicencryptionmodes>WEP</WifiBasicencryptionmodes><WifiWpaencryptionmodes>AES</WifiWpaencryptionmodes><WifiWepKeyIndex>1</WifiWepKeyIndex><WifiWpsenbl>1</WifiWpsenbl><WifiWpscfg>0</WifiWpscfg><WifiRotationInterval>60</WifiRotationInterval><WifiAssociatedStationNum>0</WifiAssociatedStationNum><wifitotalswitch>1</wifitotalswitch><wifiguestofftime>0</wifiguestofftime></Ssid><Ssid><Index>3</Index><WifiEnable>0</WifiEnable><WifiSsid>vividwireless-66AB-3</WifiSsid><WifiMac></WifiMac><WifiBroadcast>0</WifiBroadcast><WifiIsolate>0</WifiIsolate><wifi_max_assoc>32</wifi_max_assoc><WifiAuthmode>WPA2-PSK</WifiAuthmode><WifiBasicencryptionmodes>WEP</WifiBasicencryptionmodes><WifiWpaencryptionmodes>AES</WifiWpaencryptionmodes><WifiWepKeyIndex>1</WifiWepKeyIndex><WifiWpsenbl>1</WifiWpsenbl><WifiWpscfg>0</WifiWpscfg><WifiRotationInterval>60</WifiRotationInterval><WifiAssociatedStationNum>0</WifiAssociatedStationNum><wifitotalswitch>1</wifitotalswitch><wifiguestofftime>0</wifiguestofftime></Ssid></Ssids><WifiRestart>1</WifiRestart></request>'
function setWifi(value) {
    router.multiBasicSettings(token, function (error, responseBody, response) {
        if (error) fw.log("ERROR - Can't modify Wifi settings, possibly offline? " + error)
        else {
            var locateEnablePos = responseBody.indexOf("<WifiEnable>") + 12;
            var body = responseBody.substr(0, locateEnablePos) + value + responseBody.substr(locateEnablePos + 1);
            body = body.replace(/response/gi, "request").replace("</request>", "<WifiRestart>1</WifiRestart></request>")
            router.setWifi(token, body, function (error, response) {
                fw.log("Setting Huawei LTE router Wifi state to " + value + " response: " + response);
                if (error) fw.log("ERROR - Can't modify Wifi settings, possibly offline? " + error);
            });
        }
    })
}

// Receive a message from the host
function fromHost(channel, scope, data) {
    routerCmd(scope, data, false);
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
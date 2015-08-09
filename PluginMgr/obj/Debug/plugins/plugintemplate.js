"use strict";
var fw = require("../../pluginFramework")

exports.startup = function startup() {
    //Insert startup code here
    return "OK"                                                     // Return 'OK' only if startup has been successful to ensure startup errors disable plugin
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

// Initialize the plugin - DO NOT MODIFY
exports.loaded = function(iniCat, iniName, iniChannels, iniSettings, iniStore) {
    return fw.init(iniCat, iniName, iniChannels, iniSettings, iniStore)
}


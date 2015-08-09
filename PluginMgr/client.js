console.log("child");

process.on('message', function (msg) {
    console.log('CHILD got message:', msg)
    process.send({msg: 'Message receivd & resent from the child.'})
});

process.send({msg: 'Message from the child.'});
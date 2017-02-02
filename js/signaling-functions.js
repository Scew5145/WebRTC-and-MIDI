// Global variables

var receiverUid; // stores the uid of Alice, the party receiving the offer 

// WebRTC variables
var cfg = {'iceServers': [{'urls': 'stun:23.21.150.121'}]},
  con = { 'optional': [{'DtlsSrtpKeyAgreement': true}] };

/* THIS IS ALICE, THE CALLER/SENDER */

var pc1 ,  dc1 = null



var localTracks, localStream;
var negotiate = true;
var callStatus = 'disconnected';

// Since the same JS file contains code for both sides of the connection,
// activedc tracks which of the two possible datachannel variables we're using.
var activedc;

// var sdpConstraints = {
//   optional: [],
//   mandatory: {
//     OfferToReceiveAudio: true,
//     OfferToReceiveVideo: true
//   }
// }



/* -------  OFFER (Alice) ---------- */

// Creates a local offer to be sent via firebase to the receiver. uid is the id of the receiver. Called when you click the nickname in the chatroom
function createLocalOffer (uid) {
  
  pc1 = new RTCPeerConnection(cfg, con);
  pc1.ontrack = handleOnaddstream;
  pc1.onsignalingstatechange = onsignalingstatechange
  pc1.oniceconnectionstatechange = function (e) {
      if (pc1.iceConnectionState == 'disconnected') {
      hangUp();
    }  console.info('ice connection state change:', e)
  }
  pc1.onconnectionstatechange = function (e) {

    console.info('connection state change:', e)
  };
  pc1.onnegotiationneeded = onnegotiationneeded;
  pc1.onicecandidate = function (e) {
    console.log('ICE candidate (pc1)', e);
  }
  
  receiverUid = uid;
  console.log('video1')
  navigator.mediaDevices.getUserMedia({video: {facingMode: 'user'}, audio: true})
  .then(function (stream) {
    localTracks = stream.getTracks();
    localStream = stream;
    negotiate = true;
    var video = document.getElementById('localVideo')
    video.srcObject = stream;
    video.play()
    // Chrome does not yet support  pc1.addTrack(track, stream));
  
    // Set online status to "unavailable"
    var update = {};
    update[pathToOnline + "/" + currentUser.uid +"/status"] = 0;
    firebase.database().ref().update(update);
    
    // Adding the stream will trigger a negotiationneeded event!
    pc1.addStream(stream)
    // console.log(stream)
    console.log('adding stream to pc1')
  })
}

// Sets up a data stream to Bob
function setupDC1 () {
  try {
    dc1 = pc1.createDataChannel('test', {reliable: true})
    activedc = dc1  // declared in another file
    console.log('Created datachannel (pc1)')
    dc1.onopen = function (e) {
      console.log('data channel connect')
    }
    dc1.onmessage = function (e) {
      console.log('Got message (pc1)', e.data);
      if (e.data.size) {

      } else {
        if (e.data.charCodeAt(0) == 2) {
          // The first message we get from Firefox (but not Chrome)
          // is literal ASCII 2 and I don't understand why -- if we
          // leave it in, JSON.parse() will barf.
          return
        }
        console.log(e)
        var data = JSON.parse(e.data);
        if (data.type === 'message') {
          writeToChatLog(data.message, 'text-info')
          // Scroll chat text area to the bottom on new input.
          $('#chatlog').scrollTop($('#chatlog')[0].scrollHeight)
        } else {
          writeToMIDILog(JSON.stringify(data.message), 'text-info');
          // Scroll MIDI log text area to the bottom on new input.
          $('#midilog').scrollTop($('#midilog')[0].scrollHeight)
        }
      }
    }
  } catch (e) { console.warn('No data channel (pc1)', e); }
}



// Triggered when adding stream from Bob
function handleOnaddstream (e) {
  console.log('Got remote stream', e.streams)
  var remoteVideo = document.getElementById('remoteVideo')
  remoteVideo.srcObject = e.streams[0];
//  remoteVideo.play();
}


function onsignalingstatechange (state) {
  console.info('signaling state change:', state)
}

function oniceconnectionstatechange (state) {
  if (pc1.iceConnectionState == 'disconnected' || pc2.iceConnectionState == 'disconnected') {
    hangUp();
  }
  console.info('ice connection state change:', state)
}

function onicegatheringstatechange (state) {
  console.info('ice gathering state change:', state)
}

// This is triggered when we add a stream to pc1
function onnegotiationneeded (state) {
  if (negotiate) {
    console.info('Negotiation needed:', state)
    negotiate = false;
    pc1.createOffer()
    .then(function (desc) {
      return pc1.setLocalDescription(desc);
    })
    .then (function () {
      console.log('created local offer', pc1.localDescription);
      // send local description to peer via firebase
      var update = {};
      var localDescript = pc1.localDescription;
      update[pathToSignaling + '/' + receiverUid] = {offer: {localdescription: pc1.localDescription, offerer: currentUserInfo.nick}} ; 
      firebase.database().ref().update(update);
      console.log(JSON.stringify(pc1.localDescription));
      
      // create a listener for an answer from Bob
      firebase.database().ref(pathToSignaling + '/' + receiverUid + '/answer').on('value', answerListener);
  
        // Create a MIDI listener
        midisystem.selectedMidiInput.onmidimessage = onMidiMessage;
        console.log('created midi listener for ' + midisystem.selectedMidiInput.name)
        callStatus = 'connected';
      })
      .catch(function (error) {
        console.log('Error somewhere in chain: ' + error)
      });
    // set up data channel for chat and midi
    setupDC1();
    
  } else {
    console.log('no negotiation');
  }

}


// Gets triggered when Bob creates an answer. Triggered by firebase answer listener 
function answerListener(snapshot) {
  if (snapshot.val()) {
    console.log("Answer received " + JSON.stringify(snapshot.val()));
    bootbox.hideAll();
    var answer = snapshot.val();
    if (answer != -1) {
      var answerDesc = new RTCSessionDescription(answer);
      console.log('Received remote answer: ', answerDesc);
      writeToChatLog('Received remote answer', 'text-success');
      pc1.setRemoteDescription(answerDesc)
      .then (function() {
        console.log('Successfully added the remote description to pc1');
        firebase.database().ref(pathToSignaling + '/' + receiverUid + '/answer').off('value', answerListener);
      })
      .catch (function(error) {console.log("Problem setting the remote description for PC1 " + error)});
    } else {
      // call rejected
      var update = {}
      update['offer'] = null;
      firebase.database().ref(pathToSignaling + '/' + receiverUid).update(update);
      bootbox.alert("Call rejected");
    }
  }
}


/* ---------  BOB  ---------*/


var pc2,
  dc2 = null

// var pc2icedone = false

// Handler for when someone creates an offer to you in the firebase database. Listener is defined right after log in
function offerReceived(snapshot) {
  var snap = snapshot.val();
  if (snapshot.val()) {
    console.log('offer received! '+ JSON.stringify(snap));
    bootbox.confirm({
      message: "You just got a call from " + snap.offerer,
        buttons: {
          confirm: {
            label: 'Accept',
            className: 'btn-success'
          },
          cancel: {
            label: 'Reject',
            className: 'btn-danger'
          },
        },
      callback: function(result) {
        if (result) {
          console.log(snap);
          answerTheOffer(snap.localdescription);
        } else {
          console.log("Call rejected");
          // enter a -1 for answer to the offer
          var update ={answer: -1};
          firebase.database().ref(pathToSignaling + "/" + currentUser.uid).update(update);
        }
      }
    }); 
  }  
}


function answerTheOffer(offer) {
  pc2 = new RTCPeerConnection(cfg, con);
  pc2.ontrack = handleOnaddstream;
  pc2.onsignalingstatechange = onsignalingstatechange
  pc2.oniceconnectionstatechange = function (e) {
      if (pc2.iceConnectionState == 'disconnected') {
      hangUp();
    }  console.info('ice connection state change:', e)
  }
  pc2.onconnectionstatechange = function (e) {

    console.info('connection state change:', e)
  };
//  pc.onnegotiationneeded = onnegotiationneeded;
  pc2.onicecandidate = function (e) {
    console.log('ICE candidate (pc1)', e);
  }  
  pc2.ondatachannel = handleOnDataChannel; 
  
  var offerDesc = new RTCSessionDescription(offer);
  
  pc2.setRemoteDescription(offerDesc)
  .then(function() {
    writeToChatLog('Received remote offer','text-success');
    return navigator.mediaDevices.getUserMedia({video: {facingMode: 'user'}, audio: true});
  })
  .then(function (stream) {
    // Set online status to unavailable
    var update = {};
    update[pathToOnline + "/" + currentUser.uid +"/status"] = 0;
    firebase.database().ref().update(update);
    
    // Store tracks and stream to kill them when hanging up
    localTracks = stream.getTracks();
    localStream = stream;
    
    // Attach stream to video element 
    var video = document.getElementById('localVideo')
    video.srcObject = stream;
    video.play;
    // Chrome does not yet support pc2.addTrack(track, stream);
    
    // Add (local) stream to peer connection
    pc2.addStream(stream);
    
    // Create answer
    return pc2.createAnswer();
  })
  .then (function(answerDesc) {
    writeToChatLog('Created local answer', 'text-success')
    console.log('Created local answer: ', answerDesc)
    callStatus = 'connected';
    return pc2.setLocalDescription(answerDesc);
  })
  .then (function() {
    // Log in my answer to firebase
    var update = {};
    update[pathToSignaling + '/' + currentUser.uid + '/answer'] =  pc2.localDescription; 
    firebase.database().ref().update(update);
    console.log("Created node with answer " + JSON.stringify(pc2.localDescription))
    
    // Add MIDI listener
    midisystem.selectedMidiInput.onmidimessage = onMidiMessage;

  })
  .catch (function (error) {
    console.log("Error in the answer-the-offer chain", error)
  });
}

function handleOnDataChannel (e) {
  var datachannel = e.channel || e; // Chrome sends event, FF sends raw channel
  console.log('Received datachannel (pc2)', arguments)
  dc2 = datachannel
  activedc = dc2
  dc2.onopen = function (e) {
    console.log('data channel connect')
  }
  dc2.onmessage = function (e) {
    console.log('Got message (pc2)', e.data)
    if (e.data.size) {

    } else {
      var data = JSON.parse(e.data)
      if (data.type === 'message') {
        writeToChatLog(data.message, 'text-info')
        // Scroll chat text area to the bottom on new input.
        $('#chatlog').scrollTop($('#chatlog')[0].scrollHeight)
      } else {
        writeToMIDILog(JSON.stringify(data.message), 'text-info');
        // Scroll MIDI log text area to the bottom on new input.
        $('#midilog').scrollTop($('#midilog')[0].scrollHeight)
      }
    }
  }
}

//
//pc2.onsignalingstatechange = onsignalingstatechange
//pc2.oniceconnectionstatechange = oniceconnectionstatechange
//pc2.onicegatheringstatechange = onicegatheringstatechange
//
//pc2.onaddstream = handleOnaddstream

function sendMessage () {
  if ($('#messageTextBox').val()) {
    var channel = activedc;
    writeToChatLog($('#messageTextBox').val(), 'text-success')
    channel.send(JSON.stringify({message: $('#messageTextBox').val(), type: 'message'}));
    $('#messageTextBox').val('')

    // Scroll chat text area to the bottom on new input.
    $('#chatlog').scrollTop($('#chatlog')[0].scrollHeight)
  }

  return false
}



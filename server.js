var sys = require('sys'),
	util = require('util'), 
	http = require('http'),
	url = require('url'),
	io = require('socket.io'),
	TwitterNode = require('twitter-node').TwitterNode,
	config = require('./config'),
	events = require('./events');

//MongoDB
var Db = require('mongodb').Db,
  Connection = require('mongodb').Connection,
  Server = require('mongodb').Server,
  BSON = require('mongodb').BSONNative;

var host = process.env['MONGO_NODE_DRIVER_HOST'] != null ? process.env['MONGO_NODE_DRIVER_HOST'] : config.mongo.host;
var port = process.env['MONGO_NODE_DRIVER_PORT'] != null ? process.env['MONGO_NODE_DRIVER_PORT'] : Connection.DEFAULT_PORT;

var server = http.createServer(function (req, res) {
	// your normal server code
	var pathname = url.parse(req.url).pathname;
	if (pathname == '/ping'){
		res.end('pong');
		util.log("pong");
	} else {
		util.log(req.url);
	}
		
	res.writeHead (200, {'Content-Type': 'text/html'}); 
	res.end('<h1>Hi</h1>');
	
});

var longShore = http.createClient(80, 'long-shore.com');

server.listen(8080); 
util.log('Server running at http://127.0.0.1:8080/');


//Twitter Event Groups
//Events will have a scheduled time, scheduled location, and keywords to track

//helper function so we don't have to type out obvious keywords that are already contained in other event properties
//this adds split word version (Marc Jacobs), hyphen version (Marc-Jacobs), and condensed version (marcjacobs) to keywords
function buildKeywords() {
	for (event in events) {
		var eventID = event, 
			name = events[event].name, 
			keywords = events[event].keywords,
			index = keywords.length;
			
		keywords[index] = eventID;
		index++;
		var matchName = new RegExp(name, 'i');
		if(!eventID.match(matchName)) {
			keywords[index] = name;
			index++;
		}
		if (name.match(/ /g)) {
			keywords[index] = name.replace(/ /g, '-');
		}
		
	}
}

buildKeywords();


//TwitterNode
var twitterConfig = config.twitterNode;

//Build our track parameter based on groupings
var trackIndex = 0;
for (event in events) {
	var list = events[event].keywords;
	var count = list.length;
	for (var i=0; i<count; i++) {
		var keyword = list[i];
		twitterConfig.track[trackIndex] = keyword;
		trackIndex++;
	}
}

function getParentGroup( keyword ) {
	var parent = '';
	for (event in events) {
		var list = events[event].keywords;
		var count = list.length;
		for (var i=0; i<count; i++) {
			var listKeyword = list[i];
			if (keyword == listKeyword) {
				parent = event;
			}
		}
	}
	return parent;
}

var socket = io.listen(server), 
	twitter = new TwitterNode(twitterConfig);

util.log("Connecting to " + host + ":" + port);
util.log("Connecting to Twitter Streaming API. Username: "+twitterConfig.user);

var db = new Db('tweet-event', new Server(host, port, {}), {native_parser:true});

//store tweet for caching
db.open(function(err, db) {  //might need to db.close() this somewhere in the future
	
	//remove old collection and start fresh
	
	
	for (event in events) {
		db.dropCollection(event, function(err, result){
			
		});
	}
	
	
	db.dropCollection('events', function(err, result){
		sys.puts("dropped events.collection: "+sys.inspect(result));
	});
	
	
	db.dropCollection('words', function(err, result){
		sys.puts("dropped events.collection: "+sys.inspect(result));
	});
	
	
	
	//initialize event collections with basic model structure
	
	db.collection('events', function(err, collection) {
		for (event in events) {
			var eventName = event;
			//check if a collection exists for event
			db.collection(eventName, function(err, collection){
				
				collection.find(function(err, cursor){
					var event = eventName;
					cursor.count(function(err, count){
						var tweetCount = count;
						var randomColor = (function(h){return '#000000'.substr(0,7-h.length)+h})((~~(Math.random()*(1<<24))).toString(16));
						var doc = {
							"keyword": event,
							"name": events[event].name,
							"startTime": events[event].startTime,
							"duration": events[event].duration,
							"location": events[event].location,
							"latlng": events[event].latlng,
							"keywords": events[event].keywords,
							"tweetCount": tweetCount,
							"color": randomColor
						};
						db.collection('events', function(err, collection) {
						
							collection.ensureIndex({startTime: 1}, function(err, indexName){
								if (err) {
									util.log("error ensuring index: "+err);
								} else {
									//util.log("ensured index: " + indexName);
								}
								
							});
							
							collection.find({"keyword": event}, function(err, cursor){
								cursor.count(function(err, count){
										db.collection('events', function(err, collection) {
											collection.update({keyword: event}, doc, {upsert: true});
										});
								});
							});
						});
					});
				});
			});
		}
	});

	if (err) {
		sys.puts(err);
	} else {
	
		twitter 
			.addListener('error', function (error) { 
				util.log (error. message); 
			}) 
			.addListener('tweet', function (tweet) {
							
				//sort tweets by filters
				var tweetStr = tweet.text,
					message = {
					"keywords": ["default"],
					"tweet": tweet
					},
					match = false,
					messageSent = false,
					storeTweet = function( message ) {
					
						//a list of less meaningful common words to exclude from textual analysis
						var wordFilter = /\b(but|get|you|will|are|someone|that|your|have|one|could|know|yes|got|this|live|its|the|and|for|with|them|his|her|they|from|way|can|more|than|follow|how|would|even|dont|cant|not|via|much|ever|when|was|just|done|here|wear|all|wears|put|about|show|news|days|what)\b/i;
						
						
						//splitup tweet into word list
						var wordList = splitTweet(message.tweet.text);
						
						//Store tweets in the proper event collections of our mongodb
						//startTime, duration, location, tweets
						for (var i=1; i<message.keywords.length; i++) {
							var keyword = message.keywords[i];
							
							//insert tweets into event collections
							db.collection(keyword, function(err, collection) {
								//sys.puts("Inserting tweet in: "+keyword);
								collection.insert(message.tweet);
								
							});
							
							//update tweetcount in global events collection
							db.collection('events', function(err, collection){
								collection.update({"keyword": keyword}, { $inc: {"tweetCount": 1} });
							});
							
							//update words collection
							//Words Model: { word : 'wordstring', counts : { total : 100, marcjacobs : 60, prada : 40 } }
							
							db.collection('words', function(err, collection){
								var count = wordList.length;
								for (var i=0; i<count; i++) {
									var word = wordList[i];
									if(!wordFilter.test(word)){
									
										var keywords = events[keyword].keywords,
											length = keywords.length,
											match = false,
											pattern = new RegExp(word, "i");
										
										for (var j=0; j<length; j++) {
											if (keywords[j].match(pattern) || word.length < 3) {
												match = true;
											}
										}
										if (!match) {
											var increment = {
												"counts.total" : 1
											};
											increment["counts."+keyword] = 1;
											collection.update({"word": word}, { $inc: increment }, {upsert: true});
										}
									}
								}
								
							});
							
						}
					};
				
				//We can turn this off if we want to let in non-english speaking language tweets
				//Filtering for only lang=en causes excess filtering as some users still write in english from other countries.
				//if (tweet.user.lang != "en") util.log("non english user detected: "+tweet.user.lang+": "+tweetStr);
				
				if (englishTest(tweetStr) && tweet.user.lang == "en") {
					var trackCount = twitterConfig.track.length;
					for (var i=0; i<trackCount; i++) {
						var keyword = new RegExp(twitterConfig.track[i], 'i');
						
						if (tweetStr.match(keyword)) {
							var keyGroup = getParentGroup(twitterConfig.track[i]);
							message.keywords.push(keyGroup);
							match = true;
						}
					}
					
					//if still no match, also check if the hyphenated version of the keyword exists in the string
					//Twitter will match these as well
					if (!match) {
						for (var i=0; i<trackCount; i++) {
							var keyword = twitterConfig.track[i];
							if (keyword.match(/ /)){
								keyword = keyword.replace(/\s+/g, '-');
								var hyphenated = new RegExp(keyword, 'i');
								if (tweetStr.match(hyphenated)) {
									var keyGroup = getParentGroup(twitterConfig.track[i]);
									message.keywords.push(keyGroup);
									match = true;
								}
							}
						}
					}
					
					//TODO: if still no match, also check if retweeted_status.text has a match if truncated is true
					if (!match && tweet.retweeted_status) {
						for (var i=0; i<trackCount; i++) {
							var keyword = new RegExp(twitterConfig.track[i], 'i');
							
							if (tweet.retweeted_status.text.match(keyword)) {
								var keyGroup = getParentGroup(twitterConfig.track[i]);
								message.keywords.push(keyGroup);
								match = true;
							}
						}
					}
					
					if (!match && tweet.retweeted_status) {
						for (var i=0; i<trackCount; i++) {
							var keyword = twitterConfig.track[i];
							if (keyword.match(/ /)){
								keyword = keyword.replace(/\s+/g, '-');
								var hyphenated = new RegExp(keyword, 'i');
								if (tweet.retweeted_status.text.match(hyphenated)) {
									var keyGroup = getParentGroup(twitterConfig.track[i]);
									message.keywords.push(keyGroup);
									match = true;
								}
							}
						}
					}
					
					
					//if still no match, also check if the url shortened link is hiding a keyword in the full url
					//e.g. http://t.co/FTbd2Qn actually contains Prada in the url
					
					if (!match) {
						if (tweet.entities.urls.length > 0) {
							//console.log("tweet has a url");
							//console.log(tweet.entities.urls[0].url);
							//console.log(tweet.entities.urls[0].expanded_url);
							
							var url = tweet.entities.urls[0].url;
							var expanded_url = tweet.entities.urls[0].expanded_url;
							
							//if twitter isn't already providing expanded url, use long-shore
							if (expanded_url == null && !url.match(/twitpic/i)) {
								var request = longShore.request('GET', '/api/expand?url='+url, {'host': 'long-shore.com'});
								request.end();
								
								request.on('response', function (response) {
									
									if (response.statusCode != 200) {
										util.log("Error: Unexpected response code " + response.statusCode + " from long-shore.com");
										return; // Would be nice to abort the request here
									}
									
									var urlMessage = '';
									response.on('data', function (chunk) {
										urlMessage += chunk;
									});
									
									response.on('end', function(){
										
										var long_url = JSON.parse(urlMessage).long_url;
										
										//now check long_url for regex match, using hyphen check
										//if match found go ahead and broadcast socket message
										for (var i=0; i<trackCount; i++) {
											var keyword = twitterConfig.track[i];
											if (keyword.match(/ /)){
												keyword = keyword.replace(/\s+/g, '-');
												var hyphenated = new RegExp(keyword, 'i');
												if (long_url.match(hyphenated)) {
													var keyGroup = getParentGroup(twitterConfig.track[i]);
													//console.log(message.keywords);
													message.keywords.push(keyGroup);
													match = true;
													//if we haven't already sent the message, send it now
													if (!messageSent) {
														//one last check for noise specific to each keyword
														var noNoise = testNoise( message );
														if (noNoise) {
															socket.broadcast(JSON.stringify(message));
															messageSent = true;
															storeTweet(message);
															util.log("Found Match: broadcast tweet delayed by long-shore lookup callback");
														}
													}
												}
											} else {
												var singleWord = new RegExp(keyword, 'i');
												if (long_url.match(singleWord)) {
													var keyGroup = getParentGroup(twitterConfig.track[i]);
													//console.log(message.keywords);
													message.keywords.push(keyGroup);
													match = true;
													//if we haven't already sent the message, send it now
													if (!messageSent) {
														//one last check for noise specific to each keyword
														var noNoise = testNoise( message );
														if (noNoise) {
															socket.broadcast(JSON.stringify(message));
															messageSent = true;
															storeTweet(message);
															util.log("Found Match: broadcast tweet delayed by long-shore lookup callback");
														}
													}
												}
											}
										}
									});
								});
								
							} else {
								for (var i=0; i<trackCount; i++) {
									var keyword = twitterConfig.track[i];
									if (keyword.match(/ /)){
										keyword = keyword.replace(/\s+/g, '-');
										var hyphenated = new RegExp(keyword, 'i');
										if (expanded_url.match(hyphenated)) {
											var keyGroup = getParentGroup(twitterConfig.track[i]);
											message.keywords.push(keyGroup);
											match = true;
										}
									} else {
										var singleWord = new RegExp(keyword, 'i');
										if (expanded_url.match(singleWord)) {
											var keyGroup = getParentGroup(twitterConfig.track[i]);
											message.keywords.push(keyGroup);
											match = true;
										}
									}
								}
							}
							
						}
					}
					
					
					//if there are no keyword matches we should not broadcast that tweet
					//it's likely a loose match that twitter sent back to us and should get tossed
					
					//broadcast message to socket, 
					if (match && !messageSent) {
						//one last check for noise specific to each keyword
						var noNoise = testNoise( message );
						if (noNoise) {
							socket.broadcast(JSON.stringify(message));
							messageSent = true;
							storeTweet(message);
						}
					}
					else util.log("Could not find a matching event: "+tweetStr);
				} //end of englishTest Check
								
			}) 
			.addListener('limit', function (limit) { 
				util.log('LIMIT' + sys.inspect(limit)); 
			}) 
			.addListener('delete', function (del) { 
				util.log('DELETE' + sys.inspect(del)); 
			}) 
			.addListener('end', function (resp) { 
				util.log('Twitter API: wave goodbye ...' + resp. statusCode); 
			}) 
			.stream();
	}
});

function broadcastAndStoreTweet (message) {
	//filter out any tweets that match noise criteria for each keyword
	var noNoise = testNoise( message );
	if (noNoise) {
	
	}
}

function englishTest (tweetStr) {
	var str = tweetStr;
	var spanishFilter = /\b(de|la|que|y|el|los|se|un|las|del|por|con|una|es|lo|para|su|al|como|mas|pero|le|ha|sus|si|yo|ya|este|porque|muy|todo|cuando|sobre|esta|tambien|entre|ser|mi|dos|habia|nos|anos|tiene|hasta|desde|te|eso|fue|todos|puede|pues|asi|bien|vez|ni|ahora|uno|parte|ese|vida|tiempo|mismo|otro|dia|cada|siempre|hacer|donde|esa|nada|hace|entonces|decir|bueno|otra|esto|despues|ella|mundo|tanto|otros|menos|va|poco|aqui|mucho|usted|estado|estaba|ver|como|aunque|estan|les|tres|antes|gobierno|sido|casa|algo|hombre|pais|dijo|sino|forma|ano|estos|caso|hecho|durante|hoy)\b/gi;
	
	var spanishTest = str.match(spanishFilter);

	if (spanishTest && spanishTest.length > 1) return false;
	else return true;
};

function testNoise (message) {
	var str = message.tweet.text;
	var noiseMatch = false;
	for (var i=1; i<message.keywords.length; i++) {
		if (!noiseMatch) {
			var keyword = message.keywords[i];
			if (events[keyword].noise) {
				var check = str.match(events[keyword].noise);
				if (check && check.length > 0) noiseMatch = true;
			} 
		}
	}
	if (noiseMatch) {
		return false;
	}
	else return true;
}

function splitTweet ( tweetStr ) {
	var list = [], str = tweetStr, properNames = [];
	
	//remove urls
	str = str.replace(/http:\/\/\S+/gi, ' ');
	
	//remove twitter usernames mentions
	str = str.replace(/@\S+/gi, ' ');
	
	//remove hash tags and other non-alphanumeric characters
	str = str.replace(/[^a-z1-9\s]/gi, '');
	
	//remove RT at the beginning of the string
	str = str.replace(/^RT\s/gi, ' ');
	
	//remove RT in the middle of the string
	str = str.replace(/\sRT\s/gi, ' ');
	
	//save proper names
	properNames = str.match(/[A-Z][a-z]+(\s[A-Z][a-z]+)+/g);
	
	//strip proper names until later
	str = str.replace(/[A-Z][a-z]+(\s[A-Z][a-z]+)+/g, ' ');
	
	//replace all white spaces with a single white space
	str = str.replace(/\s+/g, ' ');
	str = str.replace(/^\s/, '');
	
	//split str into array list
	list = str.split(/ /);
	if (properNames && properNames.length > 0) list = properNames.concat(list);
	
	return list;
};



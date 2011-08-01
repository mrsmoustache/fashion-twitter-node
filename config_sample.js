var config = {};

config.twitterNode = {
	user: "",
	password: "",
	action: "filter",
	track: [],
	follow: []
};

config.mongo = {
	host: 'localhost' //if connecting to a remote mongoDB change this to your remote ip address or domain
};

module.exports = config;
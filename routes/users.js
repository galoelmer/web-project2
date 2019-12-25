// importing express and creating router
var express = require("express");
var router = express.Router();
// importing Users model
var User = require("../models").Users;
var Message = require("../models").Messages;
// importing jwt and bcrypt for auth and making salt rounds 10
var jwt = require("jsonwebtoken");
var bcrypt = require("bcrypt");
const saltRounds = 10;
// importing server and io from server.js for real-time
// messaging
var server = require("../server").server;
var io = require("../server").io;

router.post("/signup", (req, res) => {
    // checks to see if email already exists in the database
    User.findAll({where: {email: req.body.email}})
        .then(rows => {
            // if rows returned is not 0, the user exists, so we return a 
            // status of 409 per https://stackoverflow.com/questions/3825990/http-\
            // response-code-for-post-when-resource-already-exists
            if(rows.length > 0) {
                return res.status(409).json({
                    message: "User already exists"
                })
            }
            // if user doesn't exist, we create a hashed password of the plain text
            // version sent from the client (hope that we host on https) using bcrypt 
            // with 10 salting rounds 
            // see docs: https://www.npmjs.com/package/bcrypt
            bcrypt.hash(req.body.password, saltRounds, (err, hash) => {
                // if we encounter an error while hashing, we send back a 500
                // status code with the error from bcrypt (probably should
                // be more specific later on with a more digestable response
                // back to the user)
                if(err) {
                    return res.status(500).json({
                        error: err
                    })
                // if hashing succeeds, then we create the user in the 
                // database (should add in a type column if we make it to
                // adding realtor and owner/seller functionality)
                } else {
                    User.create({
                        email: req.body.email, 
                        firstName: req.body.firstName, 
                        lastName: req.body.lastName, 
                        password: hash
                    })
                        // alerting user that they were created. Should 
                        // also prompt for login
                        .then(result => {
                            res.status(201).json({
                                message: "User created"
                            });
                        })
                        // send status of 500 with error message from 
                        // sequelize if User.create fails
                        .catch(err => {
                            return res.status(500).json({
                                error: err
                            });
                    })
                }
            })
        })
    
});

router.post("/login", (req, res) => {
    // finds user with the email that the client sent over. 
    // If the email doesn't exist, we return a status of 401, 
    // i.e. the user doesn't get access to the page/resource 
    // until they enter the correct credentials
    // https://www.lifewire.com/401-unauthorized-error-what-it-is-and-how-to-fix-it-2622934
    User.findAll({where: {email: req.body.email}})
        .then(rows => {
            if(rows.length === 0) {
                return res.status(401).json({
                    // don't specify if username or password was incorrect
                    // so someone can't game this and determine what emails
                    // exist in db.
                    message: "Email or password enterred is incorrect"
                });
            } 
            // if the user does exist, we grab their password from the db and 
            // compare it to the password that was sent from the client 
            bcrypt.compare(req.body.password, rows[0].password, (err, result) => {
                // if there's an error (i.e. the passwords don't match), we return
                // the same message from the previous comment
                if(err) {
                    return res.status(401).json({
                        message: "Email or password enterred is incorrect"
                    });
                }
                // if the passwords match, we create a jwt containing the 
                // found users email and id (later type so we can add route
                // protection so regular and non-logged in users don't 
                // have access to listing homes api
                if(result) {
                    // npm jwt docs: https://www.npmjs.com/package/jsonwebtoken
                    const token = jwt.sign(
                    {
                        email: rows[0].email,
                        userid: rows[0].Id
                    }, 
                    process.env.JWT_KEY, 
                    {
                        expiresIn: "1hr"
                    });
                    // https://jwt.io/introduction/ good read for jwt basics and 
                    // structure behind it
                    return res.status(200).json({
                        message: "Auth successful", 
                        token: token
                    });
                }

                res.status(401).json({
                    message: "Email or password enterred is incorrect"
                })
            });
        })
        .catch(err => {
            console.log(err);
            res.status(500).json({
                error: err
            });
        });
});

// currently only works if the user has one conversation
function Conversation(senderId, recipientId) {
    this.senderId = senderId,
    this.recipientId = recipientId,
    this.messages = [];

    this.pushMessage = function(text, createdAt) {
        this.messages.push({
            text: text, 
            createdAt: createdAt
        });
    }, 

    this.sortMessages = function() {
        return messages.sort((msg1, msg2) => msg1.createdAt - msg2.createdAt);
    },

    this.equals = function(obj) {
        return this.senderId === obj.senderId && this.recipientId === obj.recipientId
    }
}

function parseMessageRow(senderId, row) {
    var message = {
        text: row.dataValues.text, 
        createdAt: row.dataValues.createdAt,
        isFromUser: senderId === row.dataValues.Users[0].dataValues.id
    }

    if(senderId === row.dataValues.recipientId) {
        message.senderId = row.dataValues.recipientId;
        message.recipientId = row.dataValues.Users[0].dataValues.id
    } else {
        message.senderId = row.dataValues.Users[0].dataValues.id ;
        message.recipientId = row.dataValues.recipientId;
    }

    return message;
}

function addMessageToConversations(message, conversations) {
    if(conversations.length > 0) {
        for(const conversation of conversations) {
            if(conversation.equals(message)) {
                return conversation.pushMessage({
                    text: message.text, 
                    createdAt: message.createdAt, 
                    isSender: message.isSender
                });
            }
        }
    }
    
    let newConversation = new Conversation(message.senderId, message.recipientId);
    newConversation.pushMessage(message.text, message.createdAt);

    return conversations.push(newConversation);
}

router.get("/chat", (req, res) => {
    Message.findAll({
        attributes: ["recipientId", "text", "createdAt"],
        include: [{
            model: User, 
            attributes: ["id"],
            $or: [
                {
                    where: {id: 2}
                }
            ],
            order: [
                ["createdAt", "DESC"], 
            ],
        }], 
        $or: [
            {
                where: {recipientId: 2}
            }
        ]
    })
    .then(rows => {
        let conversations = [];

        for(const row of rows) {
            let message = parseMessageRow(2, row);
            addMessageToConversations(message, conversations);
        }
        console.log(conversations);
    })
   
    .catch(err => {
        console.log(err);
    });

    return res.render("chat");
});

module.exports = router;
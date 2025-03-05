const { ethers } = require("hardhat");
const fs = require('fs');
const Imap = require('imap');
const Nodemailer = require('nodemailer');

const { sneezeFaucet } = require('../config.js');

const AMOUNT_TO_SEND = ethers.parseEther(sneezeFaucet.amountToSend);
const ONE_DAY_MS = 24 * 60 * 60 * 1000; // 24 hours in milliseconds

const STATE_FILE = "payoutState.json";

// If we see this, we don't reply, so we won't reply to a reply
const STOP_CONTENT = "I'm a bot that sends Sneeze Tokens";

const messageWithoutSneeze = (cause) => `Hi there, thanks for reaching out.

I'm a bot that sends Sneeze Tokens to people who are trying out the
Pollinate Framework. Pollinate is an open source solidity framework that
allows you to create a token that pays it's own transaction fees without
users needing to hold the base token.

Normally I expect people to email me their ETN address in the subject line
so I can send them a few SNZ to test with. I don't quite know what to do with
this message because it ${cause}.

If you're like to try out the Sneeze Token and learn more about Pollinate,
check out https://sneeze-it.cjdns.fr

Thanks,
SneezeIt Bot

PS. I'm just a bot, so if you reply to this message I won't know what to
do with that either.
`;

const alreadyPaid = (cause, time) => `Hello,

It looks to me like your ${cause} Sneeze Tokens today. I want to make sure
there's enough for everybody, so could you please wait until some time after
${(new Date(time + ONE_DAY_MS)).toString()}?

You can just reply to this email tomorrow, as long as the subject line
remains in tact I'll know what to do.

Thanks,
SneezeIt Bot
`;

const success = (txid) => `Hi there,

Per your request, I've just sent you ${sneezeFaucet.amountToSend} SNZ.

The transaction hash is
${txid} so
you can check it on Electroneum, but anyway you should see the SNZ in
your wallet and you can use the in the Pollinate demo app at:
https://sneeze-it.cjdns.fr

Thanks,
SneezeIt Bot

PS. I'm only a bot, but my creators would love to hear from you. You
can talk to them on X by tagging @PollinateFwrk
`;

const failure = (error) => `Hi,

It looks like something went wrong on my end. I was trying to send
you some SNZ token per your request but for some reason the transaction
didn't go through.

It might work if you try again in a few minutes - you can try again by
just replying to this email as long as you keep the subject line
intact.

Thanks,
SneezeIt Bot

PS. I'm only a bot, but my creators would love to hear from you - and
to try to figure out what went wrong! You can talk to them on X by
messaging @PollinateFwrk

Here's the error message in case it might be useful:
${error.stack}
`

/**
 * Sends a reply email using the provided SMTP transporter.
 * @param {Object} transporter - The Nodemailer transporter object (pre-configured).
 * @param {string} from - The sender's email address (e.g., your email address).
 * @param {string} to - The recipient's email address (typically the original sender).
 * @param {string} originalMessageId - The Message-ID of the original email (for threading).
 * @param {string} originalSubject - The subject of the original email (to prepend "Re:").
 * @param {string} replyText - The plain text body of the reply email.
 * @param {string} [originalReferences] - Optional: The References header of the original email (for threading).
 * @returns {Promise<Object>} - The result of the send operation (info object from Nodemailer).
 * @throws {Error} - If sending fails or required parameters are missing.
 */
async function sendReplyEmail({
  transporter,
  to,
  originalMessageId,
  originalSubject,
  replyText,
  originalReferences = ''
}) {
    // Validate required parameters
    if (!transporter || typeof transporter.sendMail !== 'function') {
        throw new Error('A valid Nodemailer transporter is required');
    }
    const from = sneezeFaucet.fromLine;
    if (!from || typeof from !== 'string') {
        throw new Error('The "from" email address is required and must be a string');
    }
    if (!to || typeof to !== 'string') {
        throw new Error('The "to" email address is required and must be a string');
    }
    if (!originalMessageId || typeof originalMessageId !== 'string') {
        throw new Error('The original Message-ID is required for threading');
    }
    if (!originalSubject || typeof originalSubject !== 'string') {
        throw new Error('The original subject is required');
    }
    if (!replyText || typeof replyText !== 'string') {
        throw new Error('The reply text is required and must be a string');
    }

    // Construct the reply subject (prepend "Re:" if not already present)
    const replySubject = originalSubject.toLowerCase().startsWith('re:')
        ? originalSubject
        : `Re: ${originalSubject}`;

    // Construct the References header
    // If originalReferences exists, append the originalMessageId; otherwise, just use originalMessageId
    const references = originalReferences
        ? `${originalReferences} ${originalMessageId}`
        : originalMessageId;

    // Define the email options for the reply
    const mailOptions = {
        from, // Sender address (e.g., '"Your Name" <your-email@example.com>')
        to, // Recipient address (original sender)
        subject: replySubject, // Reply subject
        text: replyText, // Plain text body of the reply
        inReplyTo: originalMessageId, // Links this email as a reply to the original (required for threading)
        references // Maintains the thread's References chain (optional but recommended)
    };

    try {
        // Send the email
        const info = await transporter.sendMail(mailOptions);
        console.log('Reply email sent successfully:', info.response);
        return info;
    } catch (error) {
        console.error('Error sending reply email:', error);
        throw error;
    }
}

// Function to fetch and process new emails
const fetchNewEmails = (imap) => new Promise((resolve, reject) => {
    imap.search(['UNSEEN'], (err, results) => {
        if (err) {
            return reject(new Error(`Search error: ${err.message}`));
        }

        if (!results || !results.length) {
            return resolve([]); // Resolve with empty array if no emails
        }

        const fetch = imap.fetch(results, {
            bodies: ['HEADER.FIELDS (FROM TO SUBJECT DATE MESSAGE-ID)', 'TEXT'],
            struct: true // Include the email structure to help with parsing parts
        });

        const emails = [];

        fetch.on('message', function(msg, seqno) {
            // console.log('Message #%d', seqno);
            const email = {
                headers: {},
                attrs: {},
                body: '',
            };
    
            msg.on('body', function(stream, info) {
                let buffer = '';
                stream.on('data', function(chunk) {
                    buffer += chunk.toString('utf8');
                });
                stream.once('end', function() {
                    if (info.which.includes('HEADER')) {
                        email.headers = Imap.parseHeader(buffer);
                    } else if (info.which === 'TEXT') {
                        email.body = buffer;
                    }
                });
            });

            msg.once('attributes', function(attrs) {
                // Fetch the UID from attributes
                email.attrs = attrs;
            });
      
            msg.once('end', function() {
                emails.push(email);
                // console.log('Finished message #%d', seqno);
                // console.log('Attributes:', attributes);
                // console.log(JSON.stringify(email, null, '\t'));
            });
        });

        fetch.once('error', function(err) {
            console.log('Fetch error:', err);
            reject(err);
        });
    
        fetch.once('end', function() {
            // console.log('Done fetching all messages!');
            resolve(emails);
        });
    });
});

/**
 * Extracts the plain text part from a multipart email body.
 * @param {string} body - The raw email body (MIME format).
 * @param {Object} struct - The email structure (attrs.struct) to identify boundaries and parts.
 * @returns {string|null} - The plain text content, or null if not found.
 */
function extractPlainTextFromBody(body, struct) {
    if (!body || !struct) {
        console.warn('Body or struct is missing');
        return null;
    }
  
    // Extract the boundary from the struct
    const rootPart = struct[0];
    if (rootPart.type !== 'alternative' || !rootPart.params || !rootPart.params.boundary) {
        // Plain-only emails look like this.
        // console.warn('Invalid or unsupported email structure');
        return null;
    }
    const boundary = `--${rootPart.params.boundary}`;
  
    // Split the body into parts using the boundary
    const parts = body.split(boundary);
    if (parts.length < 2) {
        console.warn('No parts found in email body');
        return null;
    }
  
    // Look for the text/plain part
    for (const part of parts) {
        // Clean the part and check for Content-Type: text/plain
        const cleanedPart = part.trim();
        if (cleanedPart.includes('Content-Type: text/plain')) {
            // Extract the content after the headers (headers and body are separated by a double newline)
            const contentStart = cleanedPart.indexOf('\r\n\r\n');
            if (contentStart === -1) {
                console.warn('No content found in text/plain part');
                return null;
            }
            // Extract the content after the headers
            let plainText = cleanedPart.substring(contentStart + 4).trim();
            // Remove any trailing boundary or leftover MIME markers
            if (plainText.endsWith('--')) {
                plainText = plainText.substring(0, plainText.length - 2).trim();
            }
            return plainText;
        }
    }
  
    console.warn('No text/plain part found in email body');
    return null;
}

async function processEmails(ctx) {
    const mails = await fetchNewEmails(ctx.imap);
    const now = Date.now();
    // console.log('>>', mails);
    for (const mail of mails) {
        let fromEmail;
        let fromName;
        (''+mail.headers.from[0]).replace(/(.*) <(.*@.*)>/, (_, name, email) => {
            fromEmail = email;
            fromName = name;
        });
        const subject = ''+mail.headers.subject[0];
        const messageId = ''+mail.headers['message-id'];
        const date = ''+mail.headers.date[0];
        const body = extractPlainTextFromBody(mail.body, mail.attrs.struct) || mail.body;

        const quotedOriginal = body
            .split('\n')
            .map(line => `> ${line}`)
            .join('\n');

        const sendReply = async (replyText) => {
            await sendReplyEmail({
                transporter: ctx.smtp,
                to: mail.headers.from[0],
                originalMessageId: messageId,
                originalSubject: subject,
                replyText: replyText + `\r\nOn ${date}, ${fromName} wrote:\r\n` + quotedOriginal,
            });
        }

        if (ctx.state.processed.has(messageId)) {
            // console.log(`Skipping already processed message ${messageId}`);
            continue;
        }

        console.log(`New message: ${messageId} from ${mail.headers.from[0]}`);

        const subjectWords = subject.split(' ').map((s) => s.toLowerCase());
        if (!(subjectWords.indexOf('sneeze') > -1 && subjectWords.indexOf('tokens') > -1)) {
            console.log(`Skipping message without sneeze tokens in subject ${messageId}`);
            ctx.state.processed.add(messageId); // Mark as processed even if skipped
            ctx.state.dirty = true;
            if (body.indexOf(STOP_CONTENT) > -1) {
                // Stop, so we don't keep replying to replies.
                continue;
            }
            await sendReply(messageWithoutSneeze("doesn't say 'Sneeze Tokens' in the subject"));
            continue;
        }

        let address;
        for (const word of subjectWords) {
            word.replace(/(0x[a-fA-F0-9]{40})/, (_, cap) => {
                address = cap;
            });
        }
        if (address) {
            if (ethers.isAddress(address)) {
                // Ok to go
            } else {
                console.log(`Not a valid address: ${address}`);
                ctx.state.processed.add(messageId); // Mark as processed even if skipped
                ctx.state.dirty = true;
                await sendReply(messageWithoutSneeze("has an ETN address that doesn't look valid"));
                continue;
            }
        } else {
            console.log(`No address in subject: ${subject}`);
            ctx.state.processed.add(messageId); // Mark as processed even if skipped
            ctx.state.dirty = true;
            await sendReply(messageWithoutSneeze("doesn't seem to have an ETN address"));
            continue;
        }

        // Check payout restrictions
        const lastUserPayout = ctx.state.userPayouts[fromEmail] || 0;
        const lastAddressPayout = ctx.state.addressPayouts[address] || 0;

        if (now - lastUserPayout < ONE_DAY_MS) {
            console.log(`User ${fromEmail} already received a payout today`);
            ctx.state.processed.add(messageId); // Mark as processed even if skipped
            ctx.state.dirty = true;
            await sendReply(alreadyPaid("email address has already requested", lastUserPayout));
            continue;
        }

        if (now - lastAddressPayout < ONE_DAY_MS) {
            console.log(`Address ${address} already received a payout today`);
            ctx.state.processed.add(messageId); // Mark as processed even if skipped
            ctx.state.dirty = true;
            await sendReply(alreadyPaid("ETN address has already received", lastAddressPayout));
            continue;
        }

        try {
            console.log(`Sending tokens to ${address} for ${fromEmail}`);
            const tx = await ctx.token.transfer(address, AMOUNT_TO_SEND);
            await tx.wait();
            console.log(`Tx successful: ${tx.hash}`);

            // Update state
            ctx.state.processed.add(messageId); // Mark as processed even if skipped
            ctx.state.userPayouts[fromEmail] = now;
            ctx.state.addressPayouts[address] = now;
            ctx.state.dirty = true;
            await sendReply(success(tx.hash));
        } catch (error) {
            console.error(`Failed to send tokens to ${address}:`, error);
            await sendReply(failure(error));
        }
    }

    if (ctx.state.dirty) {
        try {
            const saveState = {
                processed: [...ctx.state.processed], // Convert Set to array for JSON
                userPayouts: ctx.state.userPayouts,
                addressPayouts: ctx.state.addressPayouts,
            };
            fs.writeFileSync(STATE_FILE, JSON.stringify(saveState, null, 2), "utf8");
            console.log(`Saved state: ${ctx.state.processed.size} total messages processed`);
        } catch (error) {
            console.error("Error saving state file:", error);
        }
    } else {
        console.log("No new payouts, state not updated");
    }

    console.log('\n');
}

async function imapConnected(ctx) {
    console.log('Inbox opened. Waiting for new emails...');

    // Fetch initial email count
    console.log(`Total emails in inbox: ${ctx.box.messages.total}`);

    await processEmails(ctx);

    console.log('Listening for new mail...');

    // Listen for new emails
    ctx.imap.on('mail', (numNewMsgs) => {
        console.log(`New email(s) detected: ${numNewMsgs}`);
        processEmails(ctx);
    });

    // Handle connection errors
    ctx.imap.on('error', (err) => {
        console.error('IMAP error:', err);
    });

    // Handle connection close
    ctx.imap.on('end', () => {
        console.log('IMAP connection closed');
    });
}

async function main() {

    const [signer] = await ethers.getSigners();
    console.log("Using signer:", signer.address);
    const token = await ethers.getContractAt("Sneeze", sneezeFaucet.tokenAddress, signer);

    const state = {
        processed: new Set(),
        userPayouts: {}, // Twitter user ID -> last payout timestamp
        addressPayouts: {}, // Ethereum address -> last payout timestamp
        dirty: false,
    };
    if (fs.existsSync(STATE_FILE)) {
        try {
          const data = fs.readFileSync(STATE_FILE, "utf8");
          const loadedState = JSON.parse(data);
          state.processed = new Set(loadedState.processed || []);
          state.emailPayouts = loadedState.emailPayouts || {};
          state.addressPayouts = loadedState.addressPayouts || {};
          console.log(`Loaded state: ${state.processed.size} messages processed`);
        } catch (error) {
          console.error("Error loading state file:", error);
        }
    }

    // Initialize IMAP connection
    const imap = new Imap(sneezeFaucet.imapConfig);
    const smtp = Nodemailer.createTransport(sneezeFaucet.smtpConfig);

    // Handle connection ready
    imap.once('ready', () => {
        console.log('Connected to IMAP server');
        imap.openBox('INBOX', false, (err, box) => {
            if (err) throw err;
            imapConnected(Object.freeze({
                token,
                state,
                imap,
                smtp,
                box,
            }));
        });
    });

    // Connect to the IMAP server
    imap.connect();
}
main();
# Meeting Bot

Meeting Bot sits in GifOS meetings on this computer. You drive it from any other device that knows the same name and password.

## Two ways to open it

**RUN** is the bot. Type a name and a password, then Start. The app derives a secret admin meeting from that pair and joins it, plus any meeting links you listed under Auto-join. Other people see a bot badge. When it is recording or transcribing, they see those indicators too. It will not record unless the indicators are showing. While it is running, the operator page shows the meeting, who is in it, whether it is speaking or listening, the live transcript, recent commands, and errors. Respond to commands and conversation voice (none, Grok, or local) are switches on that page.

**CONTROL** is the remote. Type the same name and password, then Start. You join the same admin meeting as the controller. The panel lists the meetings the bot is in, and who is in each one. From there you can create a new meeting for the bot to host, join or leave a meeting, turn recording or transcribing on, send a line of chat, ask the bot to speak, raise or lower its hand, turn its microphone or camera on, take a snapshot of the room state, and download a transcript or a recording.

The download comes from the bot's computer, in pieces, over the admin meeting. Nothing is uploaded to a server.

## One bot at a time

Before RUN starts, the app listens for a bot that is already using this name and password. If it hears one, it says: "A bot with this name and password is already running, so pick something unique or stop the other one." You can continue only by checking Start anyway. If a second copy appears later, both show that warning.

## Name and password

Trivial pairs such as bot / bot are rejected. The app offers a generated suggestion. Anyone who can command the bot has derived the admin meeting, which means they know the password.

## Driving it from software

A script or an automated browser can drive the bot on this computer through `window.MeetingBot` in the app frame. It can also open the app with a link like `?run=meeting-bot&go.mode=run&go.name=…&go.password=…&go.start=1`. That link starts the bot only after you approve the launch. CONTROL.md, in the app's source folder, lists every call.

## Speaking

Chat stays chat. A spoken line is a separate request, and it interrupts whatever the bot is already saying. Conversation voice can answer the room: Grok Voice, or a local model spoken with Kokoro on this computer. The app frame does not call the model itself. A line the bot speaks is written into the transcript under the bot's name. The bot does not answer itself.

## Out of scope

The bot has no avatar. Hand, microphone, camera, and speech are honored by the meeting page on this computer. A build of GifOS that does not know those requests reports that, and the meeting is left as it is.

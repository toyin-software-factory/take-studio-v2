# Launch manual pass: phones and screen readers (about 30 minutes)

This is the part of the launch check that a computer cannot do. Automated tests already prove the pages have the right headings, labels and colours. They cannot tell you whether a page reads in a sensible order, whether an announcement sounds right, whether a button is easy to hit with a thumb, or whether motion feels like too much. You can.

You do not need to be an engineer. Follow the steps in order, tick one box per step, and write a note when something feels off. If a step says "should", and what you get is different, mark Fail and write what happened.

It covers three setups. You can split them between people.

| Setup | Phone or computer | Browser | Screen reader |
| --- | --- | --- | --- |
| A | iPhone | Safari | VoiceOver |
| B | Android phone | Chrome | TalkBack |
| C | Windows computer | Firefox or Chrome | NVDA |

Setup A and B take about 10 minutes each, setup C about 10. Parts 1 to 5 below are the pages. Do each part once per setup. Steps marked **(phone)** or **(computer)** are for that kind of device only.

This list answers items 3 and 5 of [launch-ui-review.md](./launch-ui-review.md) and the "real iPhone and Android checks" owed in [0021-record-with-script-review.md](./0021-record-with-script-review.md).

## Before you start

- [ ] Use a **test account** only. Sign in with an email address you made for this check, not a customer's.
- [ ] Use a **test take only**: a short clip of you saying a few made up lines (30 seconds is plenty). Never use a real person's video, and never say anything private on camera.
- [ ] Write the script for the test take in advance. Three or four short lines are enough, for example: "Hello, this is a test. I am checking the prompter. Here is a second line. This is the last line."
- [ ] Turn off the screen reader's "screen curtain" or "speech viewer" if it records anything. Nothing from this check should be saved anywhere.
- [ ] Know how to start and stop your screen reader:
  - **VoiceOver (iPhone)**: Settings, Accessibility, VoiceOver. Swipe right to move to the next item, swipe left for the previous one, double tap to press.
  - **TalkBack (Android)**: Settings, Accessibility, TalkBack. Same swipes and double tap.
  - **NVDA (Windows)**: start NVDA, then use Tab, Shift+Tab, Enter and Space. Press the Insert key plus the down arrow to read from the cursor.

Which setup, which phone or computer, and which browser version did you use? Write it here: ______________________

## How to run a step

Each step has what to do, what you should see or hear, then a result line. Do the step twice if you can: once looking at the screen, and once with the screen reader on and your eyes closed or the screen dimmed. When you read the steps below, "screen reader" means the one for your setup.

Result line: **Pass** [ ]  **Fail** [ ]  Notes: ______________________

## Part 1. The homepage

**1.1 Look.** Open the site signed out. Scroll from the top to the bottom.
Should: the page reads top to bottom in a sensible order. Nothing jumps, flickers or slides in so much that it is hard to read. No sideways scrolling. Text is large enough to read without zooming.
Pass [ ]  Fail [ ]  Notes: ______________________

**1.2 Motion feel.** Scroll slowly, then turn on "Reduce motion" in your phone or computer settings (iPhone: Settings, Accessibility, Motion. Android: Settings, Accessibility, Remove animations. Windows: Settings, Accessibility, Visual effects, Animation effects off). Reload the page.
Should: with Reduce motion on, things appear without sliding or fading for a long time. The page is still easy to follow.
Pass [ ]  Fail [ ]  Notes: ______________________

**1.3 Before and after (if it is on the page).** Find the section called "Before and after". Use it without a screen reader first.
Should: you can tell which side is the raw take and which is the finished one. The "Raw" and "Finished" labels are readable. A time saved line is shown.
Pass [ ]  Fail [ ]  Notes: ______________________

**1.4 Before and after with the screen reader.** Move through the section with the screen reader.
Should: you hear the section heading, then "Raw" and "Finished" in a clear order, then the time saved line. A transcript link can be reached and is named so you know what it opens. Any video controls announce what they do ("Play", "Mute").
Pass [ ]  Fail [ ]  Notes: ______________________

**1.5 Touch targets (phone).** Try to press each button and link in the page header and the main call to action with your thumb, without zooming.
Should: you hit the right one the first time. Nothing is so small or so close to another that you press the wrong thing.
Pass [ ]  Fail [ ]  Notes: ______________________

**1.6 Screen reader pass.** Go from the top to the bottom with the screen reader, one item at a time.
Should: you hear a skip link or can reach the main content quickly, one main heading first, then the sections in the order you see them. Pictures that matter have a short description. Nothing is read twice or read as just "button" or "link" with no name.
Pass [ ]  Fail [ ]  Notes: ______________________

## Part 2. Sign in

**2.1 Sign in page.** Press "Sign in". Type your test email address. Send the link.
Should: the email field has a spoken label ("Email"). The keyboard that opens on a phone is the email keyboard. After you send, a clear message says to check your email, and the screen reader reads it without you having to hunt for it.
Pass [ ]  Fail [ ]  Notes: ______________________

**2.2 A mistake.** Go back and send with an empty or wrong address (for example "abc").
Should: a message tells you what is wrong, in plain words, and the screen reader reads it out. Focus does not get lost.
Pass [ ]  Fail [ ]  Notes: ______________________

**2.3 Open the link.** Open the email on the same device and press the link.
Should: you land in your library. If you open the same link a second time, you see a "link expired" page with a clear way to ask for a new one.
Pass [ ]  Fail [ ]  Notes: ______________________

## Part 3. Record with a script (/record)

You need a camera and microphone for this. On the computer, use the built in ones.

**3.1 Open Record.** From the library, press "Record".
Should: a page with the script box labelled "Script (optional)" and a "Turn on camera" button. The screen reader reads the page heading first.
Pass [ ]  Fail [ ]  Notes: ______________________

**3.2 Type the script.** Type or paste your test script into the box.
Should: the text appears as you type. On a phone, the screen does not jump around, and the box is easy to see with the keyboard open.
Pass [ ]  Fail [ ]  Notes: ______________________

**3.3 Camera and microphone prompt.** Press "Turn on camera".
Should: the browser asks to use the camera and microphone. **(iPhone)** Safari asks in a small sheet: choose Allow. Check that the prompt is not hidden or covered by the page, and that VoiceOver reads the choices. After you allow, you see your own camera picture.
Pass [ ]  Fail [ ]  Notes: ______________________

**3.4 Say no, then try again.** Close the page, open Record again, press "Turn on camera" and this time choose **Don't allow** (or Block).
Should: the page tells you in plain words that the camera is blocked and how to fix it. There is a way to try again. The screen reader reads the message.
Pass [ ]  Fail [ ]  Notes: ______________________

Now allow the camera again (browser settings, site settings, camera and microphone: Allow) and go back to the Record page.

**3.5 The prompter.** With the camera on, look at the script on the screen.
Should: the script text sits in the top half of the picture, large and readable, with the current line clearly marked (a green line). You can see your face below or behind it. There are buttons for "Faster", "Larger text" and "Pause script".
Pass [ ]  Fail [ ]  Notes: ______________________

**3.6 Prompter controls.** Press "Faster", then "Larger text", then "Pause script".
Should: each press changes something you can see. With the screen reader on, each change is announced in a short phrase (for example the new speed or size, or "paused"). It is not read again every second.
Pass [ ]  Fail [ ]  Notes: ______________________

**3.7 Voice follow consent.** Find the "Follow my voice" switch and turn it on.
Should: a box opens that explains in plain words that your voice will go to a speech service while you record. There are two clear choices, one to turn it on and "Not now". The screen reader moves into the box, reads its heading and text, and keeps focus inside until you close it. Pressing "Not now" closes it and returns you to the switch.
Pass [ ]  Fail [ ]  Notes: ______________________

**3.8 Voice follow on.** Turn it on for real this time.
Should: a short message says voice following is on or getting ready. If it cannot connect, you see a plain sentence such as "Voice following isn't available right now, so it is scrolling on a timer", and the script still scrolls on its own. It is announced by the screen reader.
Pass [ ]  Fail [ ]  Notes: ______________________

**3.9 Countdown and record.** Press "Record".
Should: a 3, 2, 1 countdown. The Record button keeps keyboard focus (**computer**: it does not jump to the top of the page). The button turns into "Stop" when recording starts. The timer counts up. The script starts moving.
Pass [ ]  Fail [ ]  Notes: ______________________

**3.10 Speak the script.** Read your test script aloud at a normal pace. If voice follow is on, check the marked line.
Should: the marked line moves along with you, not far ahead of or behind you. If you pause for a while, it stops following and says so. The picture stays smooth. Notes on how it felt (too fast, too slow, jumpy): ______________________
Pass [ ]  Fail [ ]  Notes: ______________________

**3.11 Pause the script.** While recording, press "Pause script" (**computer**: also try the P key).
Should: the script stops, but the recording timer keeps counting. "Resume script" starts it again.
Pass [ ]  Fail [ ]  Notes: ______________________

**3.12 Stop.** Press "Stop".
Should: the screen reader says recording stopped. You land on a review screen titled something like "Your take", with a big play button called "Play your take". The page says nothing has left your device yet.
Pass [ ]  Fail [ ]  Notes: ______________________

**3.13 Review the take.** Press "Play your take". Look for "Record again", "Save to device" and "Use this take".
Should: the video plays with its own controls. All three actions are reachable and have clear names. They are large enough to hit with a thumb.
Pass [ ]  Fail [ ]  Notes: ______________________

**3.14 Use this take.** Press "Use this take".
Should: a progress bar shows the upload. The screen reader can read the progress. The words "Uploading. Keep this tab open." are shown. A Cancel button is available. When it finishes, you land on the take page. If you lock the phone for a few seconds while it uploads, note what happens.
Pass [ ]  Fail [ ]  Notes: ______________________

## Part 4. The take page

Wait for the take to finish processing (a few minutes). Open it from the library.

**4.1 Player.** Press play, pause, mute and full screen.
Should: each control has a spoken name. Full screen works on your device and you can get back out of it.
Pass [ ]  Fail [ ]  Notes: ______________________

**4.2 Reading order.** With the screen reader, go from the top of the page to the bottom.
Should: title, then the player, then the cut timeline, then the "Take tools" tabs. Nothing important is skipped. Nothing is read twice.
Pass [ ]  Fail [ ]  Notes: ______________________

**4.3 The cut timeline, by touch or mouse.** Look at the timeline under the player. Cuts are the blocks marked for removal. Press one.
Should: the block switches between cut and kept, the summary line under the timeline updates, and the video jumps to just before that spot. Blocks are big enough to press on a phone.
Pass [ ]  Fail [ ]  Notes: ______________________

**4.4 The cut timeline, by keyboard (computer).** Press Tab until you reach the timeline. The blocks are one Tab stop. Use the arrow keys to move between blocks, then Enter or Space to toggle one.
Should: a clear focus ring shows where you are. Tab again moves on to the list of cuts under the timeline, not through every block one by one. Enter and Space both toggle. Pressing it twice puts it back as it was.
Pass [ ]  Fail [ ]  Notes: ______________________

**4.5 The cut timeline, with the screen reader.** Move to a block.
Should: you hear its number and what it is (for example "Pause 2"), whether it is cut or kept, and why it was cut if a reason exists. When you toggle it, a short message says what changed (for example "Keep pause 2") and the summary line is read out. The wording makes sense without seeing the screen. Write down what you actually heard: ______________________
Pass [ ]  Fail [ ]  Notes: ______________________

**4.6 Missed something.** Press "Missed something?" on the player.
Should: a short confirmation is shown and announced. It does not ask for personal information.
Pass [ ]  Fail [ ]  Notes: ______________________

**4.7 Background pane.** Open the "Background" tab under "Take tools". Choose a studio background, look at the preview, then apply it.
Should: the choices are radio buttons with names. The chosen one is announced. The preview shows. A message tells you when it is applied or if something went wrong. Focus stays in a sensible place.
Pass [ ]  Fail [ ]  Notes: ______________________

**4.8 Download.** Open the "Export" tab. Press "Save edited video" and "Save original video".
Should: a download starts, or on iPhone the video opens so you can use Share, Save Video. Nothing says an error. You can find the file afterwards.
Pass [ ]  Fail [ ]  Notes: ______________________

**4.9 Delete.** Press "More actions for this take" and choose to delete your test take.
Should: a box asks you to confirm. The screen reader reads the title and what will happen. Focus stays inside the box. "Keep it" closes it and puts focus back where you were. "Delete take" removes the take and takes you back to the library.
Pass [ ]  Fail [ ]  Notes: ______________________

## Part 5. The library

**5.1 Look and read.** Open the library. Make sure there are one or two takes, upload or record a short test take if the list is empty.
Should: each take is a clear card or row with its title, status and length. The screen reader reads them in the order you see them, and each can be opened.
Pass [ ]  Fail [ ]  Notes: ______________________

**5.2 Touch targets (phone).** Open, rename and delete a test take using your thumb only.
Should: nothing is hard to hit, and the delete action cannot be pressed by accident while scrolling.
Pass [ ]  Fail [ ]  Notes: ______________________

**5.3 Delete from the library.** Delete a test take from the library.
Should: the same confirm box as on the take page. After it closes, the list updates and the screen reader says something changed, or focus moves to a sensible place.
Pass [ ]  Fail [ ]  Notes: ______________________

## How to report a failure

Send the report to Michael in HQ, one message per failure.

1. **Where**: setup (A, B or C), phone or computer model, and browser version.
2. **Which step**: the number, for example "3.7".
3. **What you did and what happened**, in one or two sentences. Say what you expected too.
4. **A screenshot or short screen recording** of the page. For an audio problem, type what the screen reader said.

**Keep it private.** Crop or blur your email address, name and anything in the video. Do not send a recording of your face or voice unless it is your own test take and you are fine with it. Do not paste tokens, links from emails, or anything from the address bar after you sign in.

## When you finish

Count the Fail boxes per setup and add the totals here. Then tell Michael. If the total is zero, the launch UI review list is closed.

| Setup | Passes | Fails | Date | Who |
| --- | --- | --- | --- | --- |
| A iPhone, Safari, VoiceOver |  |  |  |  |
| B Android, Chrome, TalkBack |  |  |  |  |
| C Windows, NVDA |  |  |  |  |

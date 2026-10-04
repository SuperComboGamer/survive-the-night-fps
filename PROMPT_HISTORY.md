# Prompt History

The prompts sent to Claude Code while building Survive the Night, in order and grouped by date.
Greetings, test messages, bare "continue"/"yes" replies, slash commands such as `/usage` and `/clear`,
and tool-generated messages are left out. Personal details and local file paths have been removed.

## 2026-09-26

### Initial Multiplayer Zombie FPS Build

> /goal create a multiplayer game using threejs and node for the authoritative web socket server including client side predictions and interpolation, performant, grungy horror game ambience in the forest, day / night cycle, ability to craft and scavage around the map, fps, inventory system, weapon switch system like cs:go (melee, pistol, primary), random crafting supplies drop around map, amechanic to get people to explore and build a base in center of map near a camp fire and broken down car, wave based, bosses every few rounds, realistic zombies, atmospheric, skybox, shotgun, pistol, ak47, knive, baseball bat, spike trap, wood barricade, destructabl buildable structures, friendly fire off, headshot bonus, sprint meter, slow health heal over time, crafting medpacks, loot drops from zombies, acid spitter zombies, fast runner zombies, tank zombies, leapers, ropers (will shoot a rope and pull you towards them), boomers (explode on death or near human), bats (fly). round based, difficulty scales based on players in game, chat panel, in game proximity voice, can drop weapons / items, well design immersive HUD, sound effets, creepy bg ambient music, splash screen with join button, max players cap. NOT MINECRAFT, but flat area near base, hilly in forest, real locations to explore, roads connecting zones through woods, include a dock, barn area, and other unique zones which have different loot to craft special weapons or items or armor, notification when players die, on death, you play as zombie trying to kill humans, all players dead game ends and restarts., flash lights. craft torches with cloth and sticks. resources scattered around map, respawn slowly to get people to explore. make game not beatable unless people build a base and explore each day. HUD to know when night starts and horde comes. no indiciator or map. best performance possible, so use uwebsockers or something better than socketio and delta compression and as minimal byte buffer events to save on bamdwidth per server tick

## 2026-09-27

### Progress Check

> /btw how is this coming along

### Iteration 2: Core Loop and Map Overhaul

> improve this game the best you can in regards to graphics, performance, playability, level design, crafting design, hud design, game mechanics, and game objectives. right now the game feels like a lot of walking without much rewards during the walk, and also the map with a bunch of straight roads from it feels poorly designed and not fun. try your best to deliver you iteration 2 of this game. the core loop should be day time rebuild, scavage, night time, where ever you and your team is, build a temp shelter to fight the horde. don't make the zombies go for the campfire, change that mechanic to instead be the humans need to find the car supplies to escape, and each horde it gets harder.

### Create Public GitHub Repo

> make a public github repo for this and commit and push all code to it

### Run the Game Locally

> run the game for me locally

### Check the Local Server

> check if it is running

### Deploy to Railway

> work on getting this deployed to railway, off main branch, using my survivethenightgame.com domain

### Run the Server

> run the server

### Restart the Server

> restart it

### Slower Day/Night Transitions

> make the game transition more slow into dark and back into daytime, it almost feels instant now which is strange

### Move Day/Night Clock to Top Right

> move the day / night cycle in HUD to top right of the screen

### Stop Zombie Attacks Through Walls

> the zombies are able to attack through walls and hit players which I don't want

### Block Interacting Through Building Walls

> I'm able to interact with items inside houses close to the walls even though I outside. I shouldn't be able to interact with stuff inside building

### Show Average FPS in HUD

> show fps average next to ping indicator in hud

### Crafting Menu Category Tabs

> add tabs for the item category in the crafting menu so it's easy to find weapons, ammo, armor, etc, you pick best categories and ordering you think we need

### Highlight Missing Crafting Resources

> in the crafting inventory menu, make it more obvious what resources I'm missing to craft the item in the hover over card

### Merge All Pull Requests

> work through merging all pull requests

### Schematic Spawn Locations

> are schematics random each game or do they spawn hard coded location?

### Add Shotgun and M4A1

> add more weapons like shotgun, m4a1

### Improve Hand Models

> improve the hand models

### Improve Zombie Models

> improve the zombie models

### Inventory Close Button

> add a close inventory button somewhere when inventory is open

### Crafting Search Filter

> add an input so a user can type the item they want when crafting and it should show the relevant related craftables. the user should be able to clear the filter easily to reset to default view

### Game Performance Pass

> improve the performance of the game

### Keep Watching and Merging PRs

> continue to watch the pull requests and merge (fix conflicts if you need). check every 5 minutes for new ones after you get through the current list

### Pull Latest From Main

> pull latest from main

### PR Status Check

> did you make a pr

### Send Home Agents With PRs

> go through existing agent sessions and send them home if their session had a pr created associated with it

### Make PR and Merge

> make pr and merge

### Restart the Server

> restart the server

### Pull Latest From Main

> pull latest from main

### Shift Clock for Morning Light

> shift the clock a bit so it's light morning when clock at 4:00 min till nightfall

### Progress Check

> /btw how is it going any improvements?

## 2026-09-28

### Zombie Walk Animations

> improve the basic zombie walk animations, and fast zombie after

### Make PR When Done

> make pr when done

### Pull Again

> pull agai

### Add a Wandering Cat

> add a cat who also walks around

### Pull Latest From Main

> pull latest from maim

### More Torch Resources Before Night 1

> crafting torches feels hard to do by night 1, add more of whatever resource we need so it's easier to craft torches, like I would expect I can build 3 torches by first night regardless of what direction i start exploring

### Q/E Toggle for Building

> improve the building to allow toggle using q and e

### Night Atmosphere and Weather Events

> add more atmosphere to game near night, like more fog, random in game weather events like rain / lightning or wind, make trees blow in stronger wind

### Zombie Dogs in Forests

> add zombie dogs if we don't already and they should also spawn in forest areas

### Polish World Textures

> /goal continue to improve the look of the game including better textures for the houses or ground or dirt paths, make pr when done, baby sit and merge when green. only be done when you confirmed the game looks better

### Smoother, Scarier Zombie Animations

> /goal continue to work on improving the animation of the zombies to be more realistic and scary, right now they move very jittery

### Mouse Smoothing Check and Setting

> is there mouse smoothing enabled on this game? something feels off when I try to play it? make pr when done with whatever you do; allow turning it of if it's on in setting

### Make PR When Done

> make pr when done

### CS:GO-Style Pistol Viewmodel

> /goal improve the fps pistol hands view, they look horrible and also move around way to much, I'd rather them move more like csgo where the arms are almost static but have some type of idle animation. make pr when done when it's improved

## 2026-09-29

### Pull Latest From Main

> pull latest from main

### Check If Work Is on Main

> is this on main, or in a pr? if not commit / pus

### Check If Work Is on Main

> is this on main or in a pr?

### Pull Latest From Main

> pull latest from main

### Apply Visual Quality From a Reference Project

> look through [a local reference project, "deadfall"] and try to apply some of the same quality to this project including shadows, fog, sun rays, quality settings, sounds, trees, foilage, etc

## 2026-09-30

### Find Missing Pistol and Hands Changes

> did I remake the pistol & hands model in a session or something? where did those change sgo

### Fix Stretched Ground Textures and Shadows

> [screenshot] the ground textures & shadows are stretched and looking strange in places, try to fix

### Commit and Pull

> commit all my changes and then pull

### Remove Black Horizontal Line Artifacts

> [screenshot] there is still a bunch of strange black horizontal lines over the screen, what is this? it's a strange artifact, fix it or remove it

### Airdrop Plane With Smoke Trail

> when the airdrop happens, make a real plane model fly over and leave a trail of smoke so we can tell where the plane came from and see the air drop

### Better Zombie and Gunshot Sounds

> improve the sound effects for the zombies and the gun shots, also when a zombie it hit don't play that silly chime

### Use CC0 Sounds

> find cc0 sounds if necessary that would work well

### Horde Spawn Locations

> when the horde spawns, where do they spawn?

### Fix Zombie Pathfinding Through Walls

> can you check the path finding it seems like sometimes their path finding tries to walk through walls, I was inside a building and they all stacked behind it as if they were trying to get to me (i also had barricades in front of the door)

### Run and Check Performance

> run the app and check the performance

### Commit and Push

> commit and push

### Brainstorm a New Enemy or Item

> Help me ideate of a new enemy or a new item we can add into this game.

### Implement the Shade Enemy

> implement this 1. The Shade (my pick). A stalker that only moves in darkness and freezes solid when lit.
> - A flashlight beam, torch radius, campfire or burning flare all pin it. The moment the light goes, it closes fast and hits hard.
> - It takes heavily reduced damage while frozen, so someone has to hold a beam on it while the team deals with it, or you ring your shelter with torches.
> - This gives torches, batteries and flares a defensive job, and the flashlight becomes a real trade-off: it pins the Shade but draws everything else.
> - The server already knows every light source and each player's facing, and has a line-of-sight check, so the cost is mostly the model and audio. make a PR when done

### Merge This

> merge this

### Review and Merge PR

> Please do a review on this and make sure that the code seems accurate and if it's good, merge it. If not fix the issues and then merge it.

### Add the Crossbow

> 2. Crossbow. Rope, sticks and scrap at the workbench, with bolts as a new ammo type.
> - Near-silent, high damage, slow reload: the ranged stealth weapon the game lacks, and the natural counter to the Screamer.
> - More work than the snare: a new ammo reserve, viewmodel and sound.
>
> Please add the crossbow, make a pull request when you're done.

### Implement an Issue

> Please implement this issue and make a pull request when you're done.

### Fix Conflicts and Merge PR (sent 3 times)

> fix conflicts merge pr

### Pull Latest From Main

> pull latest from main

### Lower Default Master Volume

> the game audio starts WAY to loud, make the master maybe half

### Missing Gunshot Sound Changes

> I thought I recently asked you to improve the gun shot noises, did that never get merged into main?

### Merge Gunshot Work and List Unmerged Branches

> ok I need you to pull that into main, also go through other branches and list them out for I think maybe other things or worktrees never got added

## 2026-10-01

### Zombie Leg Dismemberment and Crawling

> a player should be able to shoot the legs of a zombie which causes them to stumble, but if both legs are blown off they start to crawl, make the leg gib effect when it's blown off

### Overkill Zombie Gibs

> make a zombie gib if shot by a powerful gun or shot (like overkill damage)

### Car Alarm Chance 1 in 10

> make the risk of the car alarm 1 in 10

### 45-Degree Clockwise Structure Rotation

> when placing structures the right click rotate should go clockwise 45 degree each click

### Workshop Location

> where is the workshop in this game?

### Workshop Icons on Map

> a workshop icon should be on the map because right now I have no clue how to find them

### Randomized Map Each Playthrough

> find an elegant way to randomize the map each new play through, like random roads, zones, but we should always have a set of places (church, gas station, dock, etc) in every map (also can be random). and where we spawn the end game items need to be placed randomly in those places (prefer to never place 2 in the same zone). add more zones if necessary that fits the current map theme of in forest type of thing.

### Zombies Attracted to Sound

> make sure zombies are attracted to sounds, like gun shots, bombs, etc. the louder the sound, the more zombies will come rushing in.

### Wandering Zombie Herds

> add a wandering herd mechanic where 10-15 zombies wander around the map (slow walk), but when player comes close enough or sound alerts them (another session is adding that), they will start rushing the player

### Night 2 Tank Boss

> make sure we have a tank boss zombie on night 2 which can charge at players and smack them, he can also easily destroy barricades. he should look larger than the other zombies and stronger. try to play louder thumbing footsteps when he's walking

### Proximity Voice Chat and Walkie-Talkie

> allow players to chat with players with proximity effects so you can only hear players near you, but if you have walkie talkie, everyone can talk globally

### Walkie-Talkie Must Be Found

> a walkie talkie item must be found btw

### Flamethrower With Burn Damage

> add a flame thrower to the game, and it shoots fire which will catch zombies on fire, add fire dot effect that can be put on zombies

### Sound and Music Polish

> /goal continue to run and improve the sound effects in the game, music, horde music, zombie moan effects, etc. don't stop until you think we have a pretty polish set of sounds. use CC0 if possible to find good sounds that are free to use

### Building and Car Texture Polish

> /goal continue to improve the textures on the buildings, cars, etc until you think they are polished

### HUD Polish

> /goal continue to improve the hud until you think you can call it highly polished and matching to the theme of the game

### Network Efficiency

> improve the network efficiency the best you can, measure the changes before you blindly say it's good. reduce send packets, delta compression, etc

### Fix Broken Hitboxes

> the hitboxes seem broken now, when I shoot at zombies the bullet don't seem to hit, also the zombies seem to be able to hit me even though they are not close yet, debug what is broken there and fix

### Spawn Items by Name

> instead of give 67 which isn't intuative, can you make it so I can spawn using the string of item or something? then give a command I can run to list out all the item names strings

## 2026-10-02

### Continuous Improvement With Subagents (sent twice)

> /goal continue to work on improving the game any way you can, including performance, game mechanics, model design, game loop design, crafting, balance, replayability, etc. use as many subagents as possible to try to determine where or how we can improve the game, then do these improvements, each one as a separate pull request with screenshots or description as to why this change helps the game.

### Progress Check

> /btw how much more you going to go through?

### Label Open Pull Requests

> Every single pull request that's open, add an appropriate label so that I can tell if it's a bug fix, if it's a mechanic tweak, if it's a performance improvement, if it's a brand new feature that was added in. And then also add labels related to if it's inventory, if it's model based, if it's game mechanics, etc. So as I'm reviewing pull requests, I can more easily figure out what I want to actually triage.

### Merge All PRs With 10 Subagents

> Go through every pull request use ten different sub agents to concurrently Merge in pull requests fix conflicts if there are conflicts with the pull request and get them merged in

### Sync With Origin Main

> pull latest from origin main and push whatever changes I may have to main as well

### Check Leg Dismemberment Status

> I thought I asked at one point where you can shoot the legs off zombies and they start crawling, did that get added? find what claude session was adding that and see if it was done and merged to main

### Redo Leg Dismemberment in a Worktree

> ok let's start over again, do in a worktree, make pr when done

### Walking Horde on Main?

> did the walking horde make it to main?

### Give Shotgun and Ammo via Chat

> how do I give myself a shotgun and ammo using chat?

### Herd Spawn Zones

> do they stay on the road? what zone do they normal spawn at?

### Press Y to Chat

> allow pressing y to start chatting like it works in half life

### Spawn Any Zombie Type

> also allow spawning any type of zombie in game

### Show Herds on the Map?

> do you think having them (the wandering herd) show on the map would be useful or a bad game mechanic?

### PS1 Shader Setting

> add a settings toggle to turn on a ps1 shader to make it more scary and look old school

### Commit and Push

> commit and push

### Hide Collected Quest Items on Map

> when a quest item is picked up, no longer show it on the map zone so we can tell where we no longer need to look

### Validate Shooting Delay and Hitbox Reports

> someone mentioned the shooting feels off: hitboxes are off
> and massive shooting delay
> i shoot but the zombie does not get shot until 3 secconds after
> etc validate his concerns

### Hide Tip for Salvaged Cars

> after a car has been salvaged, so not show the tip help anymore. I need it to be obvious we can't salvage the car anymore

### Shorter Day/Night Cycle

> change the day night cycle, shorten it, determine the time it would take a person to walk from their spawn to 2 zones and give some time to look around for items, the peak game loop should be spawn, move fast, get to a zone or two, prepare for the horde

### Underground Mine

> add a mine where a user can go down into the mine to explore, the mine should go under the map and connect 2 of the zones together, zombies should live down there as well

### Player Leaderboard

> add a leaderboard type of thing which tracks your progress based on a unique player uui id which is stored in local storage when you first launch the app, no one else should be able to know about the uuid, the server should store stats like total kills, how many nights survived, how many game wins they've gone through, how many times they've revived other players. also add an in game leaderboard modal they can open to see how they are doing and compare against others in the game..

### Hide Controls Menu

> hide the controls menu, make that be some in game button a user must click, showing the controls on the left is distracting.

### Remember Display Name

> remember the user's display name for next time they load the app

### Rebind I for Inventory, Tab for Player List

> change i to load up inventory and tab should show a modal of who is in the game

### Remove Player List From Inventory

> remove the player list out of the inventory hud after you've done this or while doing it

### Droppable, Splittable Ammo

> add a way for a user to drop ammo, ammo should be considered an inventory stackable item and add a way to split it so a user can drop it on the ground for other's to use in case they want to share ammo

### UX Pass

> do what you can to make it a better user experience

### Tank Boss Camera Shake

> make the player's camera shake if they are close enough to the tank boss zombie when it's walking around or charging so they know something big is coming

### Mine Zone Location

> what zone is this at?

### Mine Rewards

> does anything special spawn down there? lke a cool item so make it worth exploring?

### Add a Mine Strongbox

> yeah add a strongbox

### Balance Voice Chat and Game Audio

> a user is complaining that the music / game sound is much louder than voice chat and it needs to be fixed. find a way to balance the levels so it's easier to hear people in chat, especially if they are right next to you. change the audio defaults once you find a good setting that will make the experience better

### Ideas for New Zones

> what are some other cool zones or things I should add to this game?

### New Zones, Wildlife and Buildables

> let's add cemetery, add the rail line that goes through the map with a station, add a clinic, and the fairgrounds with real things we can ride when the generator is turned on.
>
> do the ring chapel bell, sounds good
>
> relay station call supply drop sounds good
>
> add deer that run throughout the game, they can be hunted
>
> buildable generator and floodlight is cool
>
> mounted gun sounds cool as well, do all of these using sub agents so it goes faster

### Flares Don't Attract Zombies

> zombies should not be attracted to flares

### Multiple Game Servers, Server Browser and Invites

> find a way to run multiple game servers on same box and people can join existing games. add a browse games and join game button, stress test to see how much 1 game server can support, determine the max we can support. allow a share link so i can share my game with others and they'll join right into my game unless it's full.. allow creating invite only games

### Check If Work Is on Main (sent twice)

> is this on main?

### Get Work Onto Main (sent 7 times)

> get this on main

### Commit

> commit

### Stress Test Progress

> /btw how is the stress test coming

### PR Covering All Worktree Changes

> make a pr of changes, verify all worktrees changes make it into this pr

### End the Stress Test Early

> it's ok just end early with what you've found

### Commit, Push, Pull and Fix Conflicts

> commit push, pull latest from main, fix conflicts

### Clean Up Worktrees

> clean up all worktrees in this project

### Shared Map Waypoints

> waypoints a player places on map all other players should be able to see

### Night 2 Difficulty

> night 2 is insanely hard

### Night-by-Night Zombie Progression

> i think only introduce one new zombie type each night, add some more boss zombies so it's random which night they come. also the farher you get from the car spawn, make some boomers, spitters, leapers, etc. randomly spawned around. basically as people explore I want them to encountered these more powerful zombies, but bosses only come at night. make a simplier boss come at night 1 (make a new one). also the leaper doesn't seem to leap too well, fix it

### Local Friends List

> add the ability to add people to a friends list (just local storage), which allows you to see if they are playing and join them later

### Accounts, Postgres and Match Analytics

> add in some type of authentication system and postgres database to track users, allow them to register via email, get this all setup in railway and connect the service to the db, setup a way to run migrations on deployments, allow a user to sign in after they have register, save all their stats in the db, allow users to add others as friends and chat with them directly or join other people who are currently playing (join friends only), track every single match with as much analytics so we can tune the game over time to make it more enjoyable, figure out how many players were in the game, how far they made it, whatever else you think we should track

### Tune Early Days From Playtester Feedback

> help me again tweak the game, someone is saying if we made the first day and night a little longer, people could start prepairing for the bosses, help me idate what we should do from these transcripts:
>
> [Pasted Discord chat with a playtester, summarized: boss HP isn't the real problem since guns do enough damage; the first day should be about 2 minutes longer and the gap before the horde closer to a minute; later days could shrink by about 15 seconds each down to a floor of about 3 minutes; difficulty should scale by percentage rather than flat stats; long straight spots like the tunnel and the dock can be used to cheese bosses; keep the game challenging rather than making it easy.]

### Apply the Recommended Changes

> yeah make whatever changes you think is best

### Which ORM

> /btw what orm did you pick

### Deploy Auth and Database to Railway

> work on committing push and baby sit railway to verify the prod db is pushed and migrations ran and app has optional authentication for tracking player stats

### Hold Off on Deploying

> try not to deploy again, i'm playing

### Explain Difficulty Progression

> expain the difficult progress as times goes on

### Pinch Zoom on Map

> add the ability to pinch zoom in and out of map

### How the Walkie-Talkie Works

> how does walkie talkie work

### What "Radio Linked" Means

> what is radio linked?

### Click Outside to Close Inventory

> add the ability to click outside the inventory to close it

### What Happens After Collecting All Car Parts

> what happens when you get all the car parts

### Click Outside to Close Map

> same with the map i should be able to click outside to close

### Close Buttons on All Modals

> add close button top right to all modals or popups

### Riding the Railway

> can you ride the railway at all?

### Hand Pump Rail Cars

> on the railway spawn 1 or 2 hand pump rail cars that can move a player faster across the track. e to get in, then a button to pump

## 2026-10-03

### Missing Zone Labels on Map

> why do some zones have no labels in map

### Would a Minimap Help?

> do you think a minimap would be useful?

### Healing Item Count on HUD

> display how many healing items we have left on hud near health and red when out

### PS1 Shader Intensity Setting

> the ps1 shader is a bit intense, add a way to change intensoty in settings

### Keep Map Zoom Centered on Player

> when I zoom out it should stay centered on my location, if a drag then the focal point should change

### End-of-Game Difficulty Vote

> when the game ends, ask the user their thoughts on the difficult then store that in db so we can tune settings to make it better, show after they vote show others think using % line bar

### Map Rotation Toggle and Closer Default Zoom

> add the ability to toggle the map view to face in the direction the player is currently face. also start the map zoom closer in on user so they can zoom out to seem more if they want

### Commit and Push Without Releasing

> commit and push, do not release, if conflicts up stream fix using fable xhigh

### Push to Main

> yes to main

### Intro Music on Splash Screen

> play the intro.mp3 on splash screen, make sure some wind sounds from in game play over

### Night Threat Music Loop

> when night starts, play threat.mp3 on loop until day comes

### Just Swap the Background Music

> what are you doing, i just needed you to play that mp3 as bg music

### Reset Settings to Default

> add a reset to default button in settings

### Remove Old Intro Audio

> there is still a strange intro audio that plays.. i think the old one you need to delete

### User Will Test

> it's fine i'll test

### Skip to Night Command

> add a command to skip directly to 5 seconds before night

### Skip to Day Command

> same with switching to day

### Commit and Push

> commit and push

### Grass Render Distance Setting

> i think add in settings a way to toggle grass render distance or something, when I walk the grass shows up in patches

### Remember Map Zoom

> if i zoomed out in the mao then close and reopen it should keep my last zoom settings

### Identify the Crow-Like Noise

> what is tha strange noise that sometimes plays like a crow but it sounds bad

### In-Game Audio Sounds Compressed

> ok yeah the audio sound fine, but in game it sounds loud and compressed or something

### Grass Patches Still Pop In

> i'm maxing the slider but i still see empty patches load in right close to me

### Splash Screen Redesign

> [screenshot] reposition things on the splash screen to look like this image where we have text on left, amd right is the 3d env of a fly through around the map fpv eye level

### Smaller Splash Screen Text

> i think you'll need to reduce size of the text on left it looks huge

### Commit and Push

> commit push

### Push to Main

> push to main

### Fix Quick Join "Could Not Connect"

> sometimes when i press quick join it says could not connect, but i click it again amd it works. i think we try to create the game room if none exist but we don't probably wait or something to know it's open

### Do Leapers Grab On?

> does a leaper grab on to you?

### Getting Leapers Off

> is there no way to get them off yourself?

### Throw Off Leapers

> add a button to throw them off which will stun them for 1 second for you to get away

### Likely Player Strategies

> what are some common strategies you think player(s) may try to make it further

### Commit and Push Without Releasing

> commit and push, do not release, if conflicts up stream fix using fable xhigh

### Knife Viewmodel

> improve the hand holding knife model

### Pistol Viewmodel

> improve the hands model holding the pistol

### Check Railway Logs

> check railway logs for an error

### Investigate Game Crash

> game just crashed again, check logs again for any new errors

### Shorter Night

> reduce night by 30s

### Check If Work Is on Main

> is this on main?

### Fix the Rotated Hand Model

> /goal The hand model still looks terrible, like the hand is turned 90 degrees downwards. Can you make it look like a normal hand? Continue to work on this using screenshots until you have a good looking hand holding a weapon.

### Iterate on Pistol Hands With Screenshots

> /goal continue to improve the hand models for the pistol by comparing screenshots until it looks good, right now the hand still looks bad

### Check Out a Contributor's Branch

> checkout [contributor]:zombies-modes-lobby in a worktree

### Run It on a New Port

> run it on a new port when ready

### Flamethrower Lighting

> When I use the flamethrower, it would be really cool if it actually lit up the area so it had some type of lighting effect.

### Investigate Round Restart Crash

> Can you check my railway logs and try to figure out if the game crashed? When the round ended it didn't just restart a new round with everyone in the game, it seems to just kill the game.

### Salvage Crafted Items

> Add the ability to salvage items that aren't like raw resources. For example, a knife. I should be able to tear it down and get the raw resources from that knife.

### Swimming in Lakes

> add the ability to swim in the lakes

### Pathfinding Around Gates

> [screenshots] improve the path finding, the zombies seem to get stuck in areas where I enclose with a gate and next to the existing gate near relay station

### Brainstorm Zero-Downtime Deploys

> I'm pretty sure when I do a deployment or I pushed up the main, everything on railway ends up restarting and disconnecting all my users. Don't make any changes. I just want you to ideate on some strategies that we can get a deployment out there without disconnecting everyone or like gracefully persist the game state so that when the new version is deployed, the server can just automatically reconnect all the users to the exact same world with the same game state, same locations for all players and zombies, but just have it be the new version. See if that's even possible and how much work that would be.

### Inventory Item Colors and Sort Order

> Add subtle background colors to the inventory items to distinguish between weapons, armor, craftables, and consumables. And then I want you to make sure that the priority of how they show up in the inventory weapons should always be first followed by consumables followed by craftables. Equipables should be on the same precedence as weapons.

### Move Ammo to the Munitions Panel

> Refactor to make the ammo not live in the actual inventory slots and set it to the munitions bottom left panel, but then add a button so a user can click to either drop all their ammo or they can split it and drop half.

### Anti-Tank Rifle

> Add in a anti-tank rifle. It shoots one at a time. It takes a very long time to reload, but it can be good for the bosses.

### RPG Launcher

> Add an RPG weapon which again is a one shot at a time, slow to reload but it shoots a grenade that explodes on impact on the ground and does area damage.

### Falling Trees

> Make the trees fall down when there's no more things to chop on it. And then when they fall down have them fade away after like three to five seconds. Play some type of tree fall sound effect if you can find one CCO so that we know that the tree is falling down.

### Crash After Game End

> Check the logs again the game just crashed again when it finished.

### Suspect the Difficulty Vote

> Maybe it's when people try to vote.
>
> When they try to vote on the difficulty.

### Issue: Zero-Downtime Deploy Strategy 2

> make a github issue for strategy 2, make it highly detailed for anyone to implement or opus to follow in the future.

### Issue: Movable Mounted Gun

> make a gh issue for this idea: "at the army point theres a full machine gun maybe a way to move it to the base?"

### Issue: Ammo Supply Rebalance

> Players are complaining that it's hard to make ammo. Can you see if you can bump up the gunpowder and whatever other ammo crafting supplies we may need and make it more not necessarily common but just a higher drop rate or loot rate?
>
> Do this in a GitHub issue, don't actually do the work, just create an issue so I can do this later.

### Issue: Craftable Backpack and Locked Slots

> Make a GitHub issue that describes a backpack item you can craft with leather, cloth, and maybe one more craftable ingredient. And when you craft it, you can wear it on a backpack slot, and that is going to unlock ten additional slots in your inventory. I also want you to remove the inventory at the bottom where we show all of the quest items. I don't need to show that in the inventory. It's already displayed in the HUD in the top left. So remove that so we have more real estate to show more slots. Have those slots be disabled. And then if a user hovers over them, says these unlock with a backpack, so they know they can craft a backpack to unlock those inventory slots. make gh issue for this

### Heavy Item Carry Rules

> Yeah, make sure that when they're carrying this they can no longer shoot or switch. If they try to switch their weapon they drop it. But they drop the heavy item on the ground and also reduce their movement by half when they're holding it.

### Issue: Shooting While Healing

> Make a gh issue there is a bug when you are healing you're still able to click your mouse and shoot We should disable all shooting while you're actually actively healing. If someone tries to click while they're healing, it should interrupt the healing process and switch back directly to the last weapon they had.

### Issue: Interactable Item Highlight

> Make it gh issue for making items that a user can interact with glow or have some type of outline shader so it's very obvious that they can interact with it. Maybe only show this theming if they're looking at the item and they're close enough. Do some research to figure out the best approaches for this in terms of how people do it in games. I want it to not distract from the theming of the game, the horror environment, and having a bunch of stuff glowing constantly, I think will distract from that ambiance.

### Issue: Bun vs Node Performance

> Make a GitHub issue to investigate running the game using BUN vs Node and give me an actual performance table breakdown of is this worth doing? Are the performance games that much higher if I use BUN instead?

### Issue: Zombies Rejoining as Humans

> Make a github issue when I was a zombie and I died and rejoined, I rejoined but it's almost like I have the players HUD and I can turn on a flashlight. Debug I should rejoin and be forced to be a zombie still so that players can't just leave and come back and become humans.

### Issue: Hold-to-Aim Key

> make a gh issue for adding a shortcut I can hold (I play on a laptop track pad so right click is hard) which will zoom in my weapon in so I can then just left mouse click to fire

### Energy Drink Consumable

> add a consumable which refills your stamina (energy drink) and add a hotkey to quick consume it. also display an icon in the hud to the right of the stamina bar so I know how many more I have

### Recommendation Given uWebSockets

> what do you recommend as because uwebsockets is important for network efficieny

### Work in a Worktree, PR and Merge (sent twice)

> work on this in a worktree, then make a pull request, then merge when ready

### Check If Work Is on Main

> is this on main

### Do It and Make a PR

> do it, make pr when done

### Ammo Drop Buttons Do Nothing

> when I click either half or all buttons, nothing drops, verify this works, what am I doing wrong?

### Fix in a Worktree and Make a PR

> fix this in worktree make pr

### Implement in a Worktree and Make a PR

> implement in worktree make pr

### Implement in a Worktree and Make a PR

> implement this in worktree make pr when done

### Unequip Weapons by Click or Drag

> it's fixed, good job, now i need you to add in the ability to click on an equipped weapon in inventory to put into inventory, also click drag it

### Progress Check

> /btw how much longer

### Walkie-Talkie as Weapon Slot 6

> instead of needing to find a walkie talkie, make it a weapon slot 6 a user must use if they want to chat across the map, make pr when done, play some walkie talkie static when the weapon is foused, pressing attack with it should engage. all other players should hear the static when another player uses it

### Flare Gun

> add a flare gun which shoots a flare up in the air and it lights up the sky and ground for 1 minute as it rains back down

### Commit and Push to Main

> commit and push to main, do it

### Experimental Rotating Minimap

> add a mini map on hud that rotates to face where player is looking, add it as a setting flag default to false as it's experimental.. put it top left, and toggle the "goals" away somewhere else, or just make the goal items simplified so it all fits under the mini map with hover text to help player understand what they are

### Open the PR Link

> open pr link

### Fix Conflicts and Merge PR (sent twice)

> fix conflicts and merge pr

### Don't Merge the PR

> actually don't merhe the pr

### Deer Spawns

> where do deer spawn and how many

### Double the Deer

> double the numbber of deer spawn in game like do 10 groups total

### Fix Conflicts

> fix conflicts

### Commit and Push

> commit and push

### Deer Flee Distance and Dog Leather Drops

> make the deer not run away as eaerly when humans get near, like almost half the run away distances, also make zombie dogs chance to drop leather

### Issue: Mouths Move When Talking

> create a github issue that describes the following request:
>
> make mouths move when people talk, look into agent-office for how we do it

### Admin Password for Admin Commands

> add a way for me to set a password in local storage which will send to the server so i can run admin commands, spawn items, etc. make the server set the secret in env var, remove this flag we need to allow admin commands and put all these behind the admin auth check

### Minimap On by Default

> make the mini map default to on, we all like it, remove toggle from settings

### Enemies on the Minimap

> show nearby enemies on minimap as well

### Analyze Difficulty Votes

> pull latest info from railway db to determine the votes about game difficuts and give your findingd

### Halve Boss Dog HP

> half the boss dog hp, it's too hard

### Boss Dog HP Check

> is 750 good? how fast would a full clip of pistol kill it?

### Set It in Railway Without Redeploying

> set it in railway for me, but don't redeploy yet

### Boss HP Table

> what is hp of other bosses give table

### What Comes on Night 6

> so what comes on night 6?

### Stored End-of-Game Data

> what other info do we store when game ends to help tweak difficulty?

### Boss Mechanics Table

> list boss and their mechanica in a table'

### Fix Conflicts and Merge

> fix conflicts and merge

### Commit and Push to Main

> commit and push to main

### Merge PR When Green

> get this pr merged when green

### Just Merge the PR

> just get the pr merged, Ill test manually

### Implement Issue #108

> https://github.com/webdevcody/survive-the-night-fps/issues/108 implement this and make a pr

### How the Final Stand Works

> how does the final stand work?

### Pacing to Reach Later Bosses

> there are a bunch of bosses we still haven't even seen
> they come on nights 4-6 I think
> so idk what to tweek so that we can make it that far or something
>
> what do you think? we are able to collect all car parts and beat the final stand before night 3 even starts

### Island and Mainland Escape Idea

> what if we made the first map an island with a bridge, and after you fix the car you drive off the island to the main land where there is an airplane you have to fix to fly out

### Speedrun Mode

> then we could have a speedrun type of thing so people and compete

### Is It Fun?

> does this sound fun? anything I should think about?

### List of Bosses

> what bosses do we have?

### Flying Enemies

> are there flying enemies?

### When Flying Enemies Appear

> what night do they show up

### Restructure Progression

> using what we know about the bosses, my issues, the enemies, how might we better structure this so a user can make it through more nights and see more enemies and keep feeling a sense of progression

### Issue: Experience, Levels and Perks

> create a github issue that describes the following request:
>
> i want to give players experience as they kill more, beat more nights, etc, plan out a good approach for giving experience and unlocking levels which will give you perks you can pick

### Issue: Achievements

> create a github issue that describes the following request:
>
> i want you to create a bunch of achievements for in game, give good ones and some standard progression ones, some unique ones that force you to interact in zones, etc. all should be viewable in profile page for user. even if they don't log in, store progress in their local storage and still show animation banners when unlocked with cool animations. when logged in store achievements / stats on real user table or in some table.

### Create-PR Skill

> make a create pr skill which requires having screen shots of what changed, a risk section if touching backend server code, overview,do not go into detail, we just need an overview from a product owner non technical standpoint unless the pr is a bg techincal refactoring, etc. show metrics in pr as well if tuning

### Anti-Clipping Skill

> create a skill and 1 lin agents md that links to clippy.md so we know how to properply build models to prevent clipping

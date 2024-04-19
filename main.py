import os
import openai
from dotenv import load_dotenv
load_dotenv()
import logging
from dalle import Dalle
from videoMaker import videoMaker
from googleDriveUploader import upload
from parallax import applyParallax
import random
import time
import requests
import datetime
import argparse
import sys
import threading
import re

# Initialize Global Variables.
dalle = None
parser = argparse.ArgumentParser()
userPrompt = None
imageCounter = 1
base_image_dir = "./images"
download_dir = None
topics = [
    # ----------------------------------------------------------   Animal Topics   ----------------------------------------------------------
    # "realistic cat and hamster photograph",
    # "Monkey and bananas",
    # "Dogs or one dog outside",
    # ----------------------------------------------------------   Space Topics   ----------------------------------------------------------
    # "A unique planet viewed from outer space with interesting space elements in background. Realistic art style.",
    # "A spaceport with ships with distant galaxies in the background"
    # "A space battle over a planet with a main hero ship centered on a tarmac preparred for battle."
    
    # ----------------------------------------------------------   Home Topics   ----------------------------------------------------------
    # "A modern House",
    # "A city",
    # "Kitchen layout interior",
    # "Living Room Interior Design",
    # ----------------------------------------------------------   Other Topics   ----------------------------------------------------------
    # "A tree of life towering over the forest",
    # "A big or small city in space",
    # ----------------------------------------------------------   Imagination Topics   ----------------------------------------------------------
    # "A traveller",
    # "A adventure",
    # "Night time",
    # "A new place",
    # "A battle",
    # "A race",
    # "A mission",
    "Vintage",
]
themes = [
    # ----------------------------------------------------------   Animal Themes   ----------------------------------------------------------
    # """feild, grass, outside, wood, running, playing, eating""",
    # """Carpet, inside, couch, living room, warm, realistic""",
    # """Cute, hiding, peeking, rolling, playing, realistic,""",
    # """Food, hamster house, toys, cat toys,"""
    # ----------------------------------------------------------   Space Themes   ----------------------------------------------------------
    """Fiery, energy, molten, explosive, waves, shimmer, gold, white, collision, moons crashing""",
    """Blue, mysterious, rings, space shuttles, visitors, welcoming, green, signs of life on planet""",
    """Developped, cities, massive ships, space port, grey, black, shiny, scary, daunting, danger""",
    """Temporal anomolies, life, green, safe, warm, sunlight, beauty, realistic, huge trees into the sky, bridges""",
    """Orbit Black hole, gravity, waves, power, lightspeed, space travel, orbit, moons, dust, asteroids""",
    """Moons, single ship in frame, approach, weapon, electricity, dangerous, mighty""",
    """Exoplanet, hexagons, storms, ice giant, dark spot, voyager 2, horizon, rings, asteroids""",
    """Sky-pircing spires, energy storms, fauna, dimensional rifts, cosmic radiation, interstellar waystaions"""

    # ----------------------------------------------------------   Home Themes   ----------------------------------------------------------
    # """Dark, mysterious, warm light, rainy, dim, shimmer, shiny, marble, expensive, Minimalistic""",
    # """Accent colors, white, soft, natural light, friendly, cozy, modern, homey, humble"""
    # """Light, White, Gold, Shiny, Friendly, Approachable, marble, ambient, Sleek""",
    # """Pool, White, Sunny, Outdoor area, Lawn, High cieling, Glass sliding doors""",
    # # """Rustic, wood, forrestry, plants, natural light, nature, cozy, warm, earthy""",
    # """Industrial, Brick, steel, concrete, urban, raw, rustic, beautiful, grey, lightbulb""",
    # """Modern, digital, minimalist, cyberpunk, glass, shiny, LED Lighting""",
    # """Contemporary, open concept, neutral colours, large, high, flow, shapes, straight edges""",
    # # """Barn, field, outdoorsy, plants, red accents, silver, ladder, wood, cozy, homey, tools, clutter"""
]

music = {
    # "1": {"file" : "./Music/SUICIDAL-IDOL - ecstacy (slowed).mp3", "startTime" : 63.4, "secondsPerImage" : 2.245},
    # "2": {"file" : "./Music/Richard Carter - Le Monde.mp3", "startTime" : 8.42, "secondsPerImage" : 1.86},
    # "3": {"file" : "./Music/Aesthetic.mp3", "startTime" : 22.44, "secondsPerImage" : 2.774},
    # "4": {"file" : "./Music/synthwave goose - blade runner 2049.mp3", "startTime" : 16.63, "secondsPerImage" : 2.075},
    # "5": {"file" : "./Music/Hans Zimmer - Mountains (Interstellar Soundtrack).mp3", "startTime" : 118.533, "secondsPerImage" : 2},
    # "6": {"file" : "./Music/Cushy - Pushing (Royalty Free Music).mp3", "startTime" : 9.708, "secondsPerImage" : 2.392},
    "7": {"file" : "./Music/Collide (sped up).mp3", "startTime" : 36.95, "secondsPerImage" : 1.347},
}
imagesPerPrompt = 1 # Must be between 1 and 4
iterationsPerTheme = 1
topic = random.choice(topics)

def initializeAPIs():
    global dalle
    # Initialize the OpenAI API client
    openai.api_key = os.getenv("OPENAI_API_KEY")
    # Initialize DALL-E 3 client.
    logging.basicConfig(level=logging.INFO)
    cookie = os.getenv("BING_COOKIE_VALUE")
    dalle = Dalle(cookie)

def prepareFileDownloads():
    global download_dir
    # Prepare Image download destination.
    os.makedirs(base_image_dir, exist_ok=True) # Create the directory if it doesn't exist
    # Get the current date and time
    current_datetime = datetime.datetime.now()
    # Create a folder with the date and time as its title
    folder_title = current_datetime.strftime("%Y-%m-%d_%H-%M-%S")
    download_dir = os.path.join(base_image_dir, folder_title)
    # Create the folder
    os.makedirs(download_dir)

def parseArgs():
    global userPrompt
    # Check if prompt was included.
    parser.add_argument("input", nargs="?", help="User input string")
    args = parser.parse_args()
    userPrompt = args.input

def generatePrompt(topic, theme):
    prompt = """Generate a description of an image of """ + topic + """ 
                including some of the following keywords: """ + theme + """. Keep the 
                description to 200 tokens or less. Possibly mention the focus of the image, the background, the view, and lighting."""
    customPrompt = "Generate a description of " + topic + """. Make it unique and interesting. 
                Keep the art style realistic but inspire creativity and add detail. Keep the description to 135 tokens or less."""
    # Make an API call to generate text
    response = openai.Completion.create(
        model="gpt-3.5-turbo-instruct", # Specify the GPT-3.5 engine
        prompt=prompt,
        max_tokens=250,
        n = 1 # Number of responses to generate
    )
    # Extract the generated text
    image_prompt = "Generate a realistic image for: " + response.choices[0].text + "Photorealistic style! No words allowed."
    print(response.choices[0].text)
    return image_prompt

def generateThemes(topic, numberOfThemes, numberOfKeyWordsPerTheme):
    global themes
    prompt = "You are a cinematic world builder for fantasy movies. Create " + str(numberOfThemes) + """ interesting lists of 
    """ + str(numberOfKeyWordsPerTheme) + " words, locations, or objects each to describe different thematic scenes involving: " + topic + """.
    Keep your answer to the point and concise. Only the lists please. Make the lists very grounded in their individual themes."""
    response = openai.Completion.create(
        model="gpt-3.5-turbo-instruct", # Specify the GPT-3.5 engine
        prompt=prompt,
        max_tokens=250,
        n = 1 # Number of responses to generate
    )
    # Extract the generated text
    ans = response.choices[0].text.replace('\n', '').replace('.', '').replace(':', ',').replace('-',',')
    ans = re.split(r'\d+', ans)
    themes = [item for item in ans if item]
    for theme in themes:
        print(theme)
    print(len(themes))

def downloadImages():
    global imageCounter
    urls = dalle.get_urls(imagesPerPrompt)
    random.shuffle(urls)
    for url in urls:
        response = requests.get(url)
        filename = os.path.join(download_dir, "image_"+str(imageCounter)+".jpg") # Extract the image filename from the URL
        # Save the image to the specified directory
        with open(filename, "wb") as file:
            file.write(response.content)
        print(f"Downloaded: {filename}")
        imageCounter += 1

def generateImages(iterationsPerTheme = iterationsPerTheme):
    if userPrompt:
        print("Running user prompt.")
        dalle.create("Generate a realistic image for: " + userPrompt + "No words allowed.")
        countdown_sleep(30)
    else:
        waitTime = iterationsPerTheme*len(themes)*12
        thread = threading.Thread(target=countdown_sleep, args=(waitTime,))
        thread.start()
        for theme in themes:
            for i in range(iterationsPerTheme):
                dalle.create(generatePrompt(topic, theme))
                # countdown_sleep(len(themes)*20) # Gives time for the AI to generate content before switching to the creations page to gather urls.
        thread.join()

def countdown_sleep(seconds):
    for i in range(seconds, 0, -5):
        sys.stdout.write(f"\rRemaining time: {i} seconds")
        sys.stdout.flush()
        time.sleep(5)
    sys.stdout.write(f"\rDownloading Images...\n")


def main():
    download_dir = './images/2024-04-14_19-34-56' # Remove when uncommenting.

    # initializeAPIs()
    # generateThemes(topic, 16, 5) # Number of themes (arg2) should be at least 3. Otherwise splitting breaks.
    # prepareFileDownloads()
    # parseArgs()
    # generateImages()
    # downloadImages()
    randomSongKey = random.choice(list(music.keys()))
    video = videoMaker(download_dir, music[randomSongKey]["secondsPerImage"])
    video.addMusic(music[randomSongKey]["file"], music[randomSongKey]["startTime"])

    #     upload(os.path.join(download_dir, "video.mp4"))
    # applyParallax("./images/2024-04-14_19-34-56/image_6.jpg")

if __name__ == "__main__":
    main()
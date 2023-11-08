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

# Initialize Global Variables.
dalle = None
parser = argparse.ArgumentParser()
userPrompt = None
base_image_dir = "./images"
download_dir = None
topics = [
    "A realistic House with a front porch",
    "A city",
    "Kitchen layout interior",
    "Living Room Interior Design",
]
themes = [
    """Dark, mysterious, warm light, rainy, dim, shimmer, shiny, marble, expensive, Minimalistic""",
    """Accent colors, white, soft, natural light, friendly, cozy, modern, homey, humble"""
    """Light, White, Gold, Shiny, Friendly, Approachable, marble, ambient, Sleek""",
    """Rustic, wood, forrestry, plants, natural light, nature, cozy, warm, earthy""",
    """Industrial, Brick, steel, concrete, urban, raw, rustic, beautiful, grey, lightbulb""",
    """Modern, digital, minimalist, cyberpunk, glass, shiny, LED Lighting""",
    """Contemporary, open concept, neutral colours, large, high, flow, shapes, straight edges""",
    """Barn, field, outdoorsy, plants, red accents, silver, ladder, wood, cozy, homey, tools, clutter"""
]
music = {
    # "1": {"file" : "./Music/SUICIDAL-IDOL - ecstacy (slowed).mp3", "startTime" : 64, "secondsPerImage" : 2},
    # "2": {"file" : "./Music/Richard Carter - Le Monde.mp3", "startTime" : 8, "secondsPerImage" : 2},
    # "3": {"file" : "./Music/Aesthetic.mp3", "startTime" : 22, "secondsPerImage" : 2.5},
    "4": {"file" : "./Music/synthwave goose - blade runner 2049.mp3", "startTime" : 16, "secondsPerImage" : 3},
}
imagesPerPrompt = 2 # Must be between 1 and 4

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
    prompt = "Generate a description of a " + topic + """ 
                including five of the following keywords: """ + theme + """. Keep the 
                description to 100 tokens or less."""
    # Make an API call to generate text
    response = openai.Completion.create(
        engine="text-davinci-003",  # Specify the GPT-3.5 engine
        prompt=prompt,
        max_tokens=100,
        n = 1 # Number of responses to generate
    )
    # Extract the generated text
    image_prompt = "Generate an image for: " + response.choices[0].text
    print(response.choices[0].text)
    return image_prompt

def downloadImages():
    imageCounter = 1
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

def generateImages():
    if userPrompt:
        print("Running user prompt.")
        dalle.create("Generate an image for: " + userPrompt)
        countdown_sleep(30)
    else:
        waitTime = 180
        thread = threading.Thread(target=countdown_sleep, args=(waitTime,))
        thread.start()
        topic = random.choice(topics)
        for theme in themes:
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
    # for i in range(0, 2):
    #     initializeAPIs()
    #     prepareFileDownloads()
    #     parseArgs()
    #     generateImages()
    #     downloadImages()
    #     randomSongKey = random.choice(list(music.keys()))
    #     # download_dir = './images/2023-11-05_18-58-17' # Remove when uncommenting.
    #     video = videoMaker(download_dir, music[randomSongKey]["secondsPerImage"])
    #     video.addMusic(music[randomSongKey]["file"], music[randomSongKey]["startTime"])
    #     upload(os.path.join(download_dir, "video.mp4"))
    applyParallax("./images/2023-11-06_01-03-17/image_2.jpg")

if __name__ == "__main__":
    main()
import os
import openai
from dotenv import load_dotenv
load_dotenv()
import logging
from dalle import Dalle
import random
import time
import requests
import datetime
import threading
import argparse

# Initialize Global Variables.
dalle = None
parser = argparse.ArgumentParser()
userPrompt = None
base_image_dir = "./images"
download_dir = None
topics = [
    "Interior Design of a House",
    "Exterior Design of a House",
    "Design of a highway bridge over a river",
    "Mansion Design",
    "Kitchen layout interior",
    "Living Room Interior Design"
]
topic = random.choice(topics)
themes = [
    #"""Dark, mysterious, warm light, dim, shimmer, shiny, marble, expensive, Minimalistic""",
   #"""Light, White, Gold, Shiny, Friendly, Approachable, marble, ambient, Sleek""",
    #"""Rustic, wood, forrestry, plants, natural light, nature, cozy, warm, earthy""",
    """Industrial, Brick, steel, concrete, urban, raw, rustic, machinery, grey, lightbulb""",
    """futuristic, digital, minimalist, cyberpunk, glass, shiny, LED Lighting""",
    """Contemporary, open concept, neutral colours, large, high, flow, shapes, straight edges"""
]
imagesPerPrompt = 1 # Must be between 1 and 4

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


def generatePrompt(theme):
    prompt = "Generate a description of a " + topic + """ 
                including five of the following keywords: """ + theme + """. Keep the 
                description to 75 words or less."""
    # Make an API call to generate text
    response = openai.Completion.create(
        engine="text-davinci-003",  # Specify the GPT-3.5 engine
        prompt=prompt,
        max_tokens=100,  # Adjust the maximum number of tokens in the response as needed
        n = 1 # Number of responses to generate
    )
    # Extract the generated text
    image_prompt = "Generate an image for: " + response.choices[0].text
    print(image_prompt)
    return image_prompt


def downloadImages():
    imageCounter = 1
    urls = dalle.get_urls(imagesPerPrompt)
    for url in urls:
        response = requests.get(url)
        filename = os.path.join(download_dir, "image"+str(imageCounter)+".jpg") # Extract the image filename from the URL
        # Save the image to the specified directory
        with open(filename, "wb") as file:
            file.write(response.content)
        print(f"Downloaded: {filename}")
        imageCounter += 1


def generateImages():
    if userPrompt:
        print("Running user prompt.")
        dalle.create("Generate an image for: " + userPrompt)
    else:
        # threads = []
        for theme in themes:
            dalle.create(generatePrompt(theme))
            time.sleep(32)
        #     thread = threading.Thread(target=getImage, args=(generatePrompt(theme), ))
        #     threads.append(thread)
        #     thread.start()
        #     time.sleep(10)
        # for thread in threads:
        #     thread.join()
    

def main():
    initializeAPIs()
    prepareFileDownloads()
    parseArgs()
    generateImages()
    time.sleep(30) # Gives time for the AI to generate content before switching to the creations page to gather urls.
    downloadImages()

if __name__ == "__main__":
    main()
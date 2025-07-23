import os
import openai
from dotenv import load_dotenv
load_dotenv()
import logging
from dalle import Dalle
from imageGenerator import imageGenerator
from videoMaker import VideoMaker
from googleDriveUploader import upload
from parallax import Parallax
import random
import time
import requests
import datetime
import argparse
import sys
import threading
import re
import json

# Initialize Global Variables.
imageCreator = None
dalle = None
parser = argparse.ArgumentParser()
userPrompt = None
imageCounter = 1
base_image_dir = "./images"
download_dir = ""
imagesPerPrompt = 1 # Must be between 1 and 4
iterationsPerTheme = 1

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
    # "Living Room Interior Design. Include windows.",
    "Tightly Packed Multilevel Interior Loft Home Layout viewed from top corner of room. Include living space, stairs to connecting bedroom, kitchen area, and view out of windows."
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
    # "Vintage",
]
prompts = {}

music = {
    # "1": {"file" : "./Music/SUICIDAL-IDOL - ecstacy (slowed).mp3", "startTime" : 63.4, "secondsPerImage" : 2.245},
    # "2": {"file" : "./Music/Richard Carter - Le Monde.mp3", "startTime" : 8.42, "secondsPerImage" : 1.86},
    # "3": {"file" : "./Music/Aesthetic.mp3", "startTime" : 22.44, "secondsPerImage" : 2.774},
    # "4": {"file" : "./Music/synthwave goose - blade runner 2049.mp3", "startTime" : 16.63, "secondsPerImage" : 2.075},
    # "5": {"file" : "./Music/Hans Zimmer - Mountains (Interstellar Soundtrack).mp3", "startTime" : 118.533, "secondsPerImage" : 2},
    # "6": {"file" : "./Music/Cushy - Pushing (Royalty Free Music).mp3", "startTime" : 9.708, "secondsPerImage" : 2.392},
    # "7": {"file" : "./Music/Collide (sped up).mp3", "startTime" : 36.95, "secondsPerImage" : 1.347},
    # "8": {"file" : "./Music/Amor Na Praia (Super Slowed).mp3", "startTime" : 0.0, "secondsPerImage" : 2.8},
    # "9": {"file" : "./Music/Pasos De Fuego.mp3", "startTime" : 7.00, "secondsPerImage" : 2.8},
    "10": {"file" : "./Music/Levitate.mp3", "startTime" : 58.00, "secondsPerImage" : 3.15},
}
topic = random.choice(topics)
function_schema = {
    "name": "generate_image_prompts",
    "description": "Generate high-quality, detailed DALL·E 3 image prompts",
    "parameters": {
        "type": "object",
        "properties": {
            "prompts": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "title": {"type": "string"},
                        "detail": {"type": "string"},
                    },
                    "required": ["title", "detail"]
                }
            }
        },
        "required": ["prompts"]
    }
}

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

def initializeAPIs():
    global dalle
    global imageCreator
    global download_dir
    # Initialize the OpenAI API client
    openai.api_key = os.getenv("OPENAI_API_KEY")
    # Initialize DALL-E 3 client.
    logging.basicConfig(level=logging.INFO)
    cookie = os.getenv("BING_COOKIE_VALUE")
    dalle = Dalle()
    imageCreator = imageGenerator(cookie, os.path.abspath(download_dir))

def parseArgs():
    global userPrompt
    # Check if prompt was included.
    parser.add_argument("input", nargs="?", help="User input string")
    args = parser.parse_args()
    userPrompt = args.input

def generatePrompt(topic, theme):
    prompt = """Generate a description of an image of """ + topic + """ 
                for an image generator including some of the following keywords: """ + theme + """. Keep the description to 150 tokens or less. 
                Describe the focus of the image, camera angle, background, the view, and lighting. 
                Be visual, don't talk about anything that can't be visualized by the image generator. No humans or people allowed in your description."""
    customPrompt = "Generate a description of " + topic + """. Make it unique and interesting. 
                Keep the art style realistic but inspire creativity and add detail. Keep the description to 135 tokens or less."""
    # Make an API call to generate text
    response = openai.chat.completions.create(
        model="gpt-4o",
        messages=[
            {"role": "system", "content": "You are a prompt engineer that specializes in writing detailed, imaginative prompts for AI image generators like DALL·E, Midjourney, and Stable Diffusion. Your output should be a single, descriptive sentence suitable for input into an AI image generator — clear, rich in visual details, and optimized for beautiful output."},
            {"role": "user", "content": prompt}
        ],
        max_tokens=200,
        n=1,
        temperature=1.2
    )
    # Extract the generated text
    image_prompt = "Generate a realistic, highly detailed, 4k realism image for: " + response.choices[0].message.content.strip() + "Photorealistic style! 4k realism No words allowed."
    print(response.choices[0].message.content)
    return image_prompt

def generatePrompts(topic, numberOfPrompts):
    global prompts
    response = openai.chat.completions.create(
        model="gpt-4o",  # or "gpt-4-1106-preview"
        temperature=1.1,  # High creativity for more vivid prompts
        messages = [
                {
                    "role": "system",
                    "content": f"""
                    You are a prompt engineer for visually compelling images made by DALL·E 3 on the topic of {topic}.
                    Your job is to output visually detailed prompts in valid JSON format.

                    Instructions:
                    - Use *visual language only* — no vague or subjective terms like "dynamic", "dramatic", "precisely", "emphasizing", or "interesting"
                    - Focus on what the camera sees — do not speculate on symbolism, emotion, or backstory

                    Each item must include:
                    - "title": An eye-catching, creative 3-6 word title of the image
                    - "detail description": A vivid prompt designed for DALL·E 3 (120-150 words). Include:
                    • Reference concrete elements in the scene — describe what appears in the foreground, midground, and background
                    • Include the camera angle or point of view (e.g., aerial view, low-angle close-up, zoom out)
                    • Specify lighting conditions (e.g., golden hour sunlight casting long shadows from the left, soft blue ambient glow, harsh spotlight from overhead, neon, warm, glow)
                    • Describe environmental details (e.g., fog drifting between buildings, cracked stone pavement, rain-slick rooftops, star-filled sky)
                    • Environmental elements (e.g., fog, terrain, architecture)
                    • Clear spatial references (e.g., "upper right", "center foreground")
                    """
                },
                {
                    "role": "user",
                    "content": f"Generate {numberOfPrompts} image prompt objects as described."
                }
        ],
        tools=[
            {
                "type": "function",
                "function": function_schema
            }
        ],
        tool_choice={"type": "function", "function": {"name": "generate_image_prompts"}}
    )

    # Extract and parse the structured tool output
    tool_call = response.choices[0].message.tool_calls[0]
    arguments = json.loads(tool_call.function.arguments)
    prompts_list = arguments["prompts"]
    prompts = {prompt["title"]: prompt["detail"] for prompt in prompts_list}
    
    for title in prompts.keys():
        print(f"\nTitle: {title}")
        detail = prompts[title]
        print(f"Description: {detail}")
        prompts[title] = "realistic, hyper detailed, full screen image, 4k realism. " + prompts[title]
        
        

    # # Extract the generated text
    # ans = response.choices[0].message.content.replace('\n', '').replace('.', '').replace(':', ',').replace('-',',')
    # ans = re.split(r'\d+', ans)
    # themes = [item for item in ans if item]
    # for theme in themes:
    #     print(theme)
    # print(len(themes))
    # # Trim themes down to desired length specified.
    # if len(themes) > numberOfThemes:
    #     themes = themes[:numberOfThemes]

def countdown_sleep(seconds):
    for i in range(seconds, 0, -5):
        sys.stdout.write(f"\rRemaining time: {i} seconds")
        sys.stdout.flush()
        time.sleep(5)

def generateBingImages(iterationsPerTheme = iterationsPerTheme):
    threads = []
    maxThreads = 3 # Actual maximum bing chat allows to prompt at once. Cannot increase.
    semaphore = threading.Semaphore(maxThreads)

    def threadTask(prompt):
        semaphore.acquire()
        imageCreator.create(prompt)
        semaphore.release()

    for title in prompts.keys():
        prompt = prompts[title]
        thread = threading.Thread(target=threadTask, args=(prompt,))
        thread.start()
        threads.append(thread)
    
    for thread in threads:
        thread.join()

def generateDalleImages(test=True):
    threads = []
    maxThreads = 5
    semaphore = threading.Semaphore(maxThreads)

    def threadTask(prompt):
        semaphore.acquire()
        if test:        
            dalle.createTestImage(download_dir, prompt)
        else:
            dalle.createImage(download_dir, prompt)
        countdown_sleep(60)
        semaphore.release()

    for title in prompts.keys():
        prompt = prompts[title]
        thread = threading.Thread(target=threadTask, args=(prompt,))
        thread.start()
        threads.append(thread)
    
    for thread in threads:
        thread.join()


def main():
    download_dir = "./images/TestImages/2025-07-23_00-44-42" # Remove when uncommenting.

    # prepareFileDownloads()
    # initializeAPIs()
    # generatePrompts(topic, 8) # Number of themes (arg2) should be at least 3. Otherwise splitting breaks. Arg 3 is keywords.
    # generateDalleImages(test=False)

    randomSongKey = random.choice(list(music.keys()))
    secondsPerImage = music[randomSongKey]["secondsPerImage"]
    videoMaker = VideoMaker()
    parallaxAgent = Parallax()

    video = parallaxAgent.applyParallax(download_dir, secondsPerImage, addNumbers=True, addText=True, text="Where can you live\n100 days if Mr. Beast\nmade you?")
    videoMaker.addMusic(video, music[randomSongKey]["file"], music[randomSongKey]["startTime"])

    # upload(os.path.join(download_dir, "video.mp4"))

    # Testing image prompts
    # generatePrompts(topic, 1, 1)
    # for theme in themes:
    #     prompt = generatePrompt(topic, theme)

if __name__ == "__main__":
    main()
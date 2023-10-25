import os
import openai
from dotenv import load_dotenv
load_dotenv()
import logging
from dalle import Dalle
import random
import urllib.request
import time


# Initialize the OpenAI API client
openai.api_key = os.getenv("OPENAI_API_KEY")

# Initialize Dalle API
cookie = os.getenv("BING_COOKIE_VALUE")
logging.basicConfig(level=logging.INFO)
dalle = Dalle(cookie)

# Text to send as a prompt to the model
topics = [
    "Interior Design of a House",
    "Exterior Design of a House",
    "Design of a highway bridge over a river",
    "Mansion Design",
    "Kitchen layout interior",
    "Living Room Interior Design"
]
themes = [
    """Dark, mysterious, warm light, dim, shimmer, shiny, marble, expensive, Minimalistic""",
    """Light, White, Gold, Shiny, Friendly, Approachable, marble, ambient, Sleek""",
    """Rustic, wood, forrestry, plants, natural light, nature, cozy, warm, earthy""",
    """Industrial, Brick, steel, concrete, urban, raw, rustic, machinery, grey, lightbulb""",
    """futuristic, digital, minimalist, cyberpunk, glass, shiny, LED Lighting""",
    """Contemporary, open concept, neutral colours, large, high, flow, shapes, straight edges"""
]

topic = random.choice(topics)
n = 1
for theme in themes:
    prompt = "Generate a detailed description of a " + topic + """ 
                and five of the following keywords: """ + theme + """. Keep the 
                description to 50 words or less."""
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
    
    # Generate Image.
    dalle.create(image_prompt)
    time.sleep(30) # Gives time for the AI to generate content before switching to the creations page to gather urls.
    urls = dalle.get_urls()
    dalle.download(urls, "./images")
    # image = openai.Image.create(
    #     prompt=image_prompt,
    #     n=1,
    #     size="1024x1024"
    # )
    # image_url = image['data'][0]['url']
    # save_path = "./images/image" + str(n) + ".jpg"

    # try:
    #     urllib.request.urlretrieve(image_url, save_path) # Download successful.
    # except urllib.error.URLError as e:
    #     print(f"Failed to download the image: {e}")

    # Show progress.
    print("Image " + str(n) + image_prompt)
    n = n + 1
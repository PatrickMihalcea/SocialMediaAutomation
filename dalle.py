import datetime
import logging
import os
import requests
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from undetected_chromedriver import Chrome, ChromeOptions
import time


# Main class
class Dalle:
    """
    A class used to interact with the DALL-E 3 Unofficial API

    ...

    Attributes
    ----------
    options : ChromeOptions
        a ChromeOptions object to configure the Chrome driver
    driver : Chrome
        a Chrome driver object to interact with the website
    cookie_value : str
        a string representing the cookie value to bypass automation detection

    Methods
    -------
    get_time():
        Returns the current time in the format "[%d/%m/%Y %H:%M:%S]"
    get_time_save():
        Returns the current time in the format "%d-%m-%Y %H-%M-%S"
    download(urls: list, save_folder: str):
        Downloads images from the provided URLs and saves them in the specified folder
    create(query: str):
        Opens the Bing Image Creator (DALL-E 3) and adds a cookie
    get_urls():
        Extracts and returns image URLs from the website


    Usage:
    ------
    # Import the necessary module
    import logging
    from dalle3 import Dalle

    # Set up logging
    logging.basicConfig(level=logging.INFO)

    # Instantiate the Dalle class with your cookie value
    dalle = Dalle("")

    # Open the website with your query
    dalle.create(
        "Fish hivemind swarm in light blue avatar anime in zen garden pond concept art anime art, happy fish, anime scenery"
    )

    # Get the image URLs
    urls = dalle.get_urls()

    # Download the images to your specified folder
    dalle.download(urls, "images/")
    """
    def __init__(self, cookie_value: str):
        self.options = ChromeOptions()
        self.options.add_argument("--disable-blink-features=AutomationControlled")
        self.options.add_argument("--headless")
        self.driver = Chrome(options=self.options)
        self.cookie_value = cookie_value

        self.originalImageSets = set()
        self.loadOriginalImageSets()

        self.threads = []
    
    def loadOriginalImageSets(self):
        cookie = {"name": "_U", "value": self.cookie_value}
        listenerQuery = "https://www.bing.com/images/create"
        self.driver.get(listenerQuery)
        self.driver.add_cookie(cookie)
        self.driver.refresh()
        button_id = "gil_n_rc"  # "Creations" button on create page.
        try:
            button = WebDriverWait(self.driver, 10).until(
                EC.presence_of_element_located((By.ID, button_id))
            )
            button.click()
        except Exception as e:
            print(f"Error in loadOriginal \n{e}")

        self.originalImageSets = set(
            element.get_attribute("href")
            for element in WebDriverWait(self.driver, 20).until(
                EC.presence_of_all_elements_located((By.CLASS_NAME, "girr_set "))
            )
        )

        self.originalImageSets.update(set(
            element.get_attribute("href")
            for element in WebDriverWait(self.driver, 20).until(
                EC.presence_of_all_elements_located((By.CLASS_NAME, "girr_set.seled"))
            )
        ))

    def create(self, query: str):
        """Opens the Bing Image Creator (DALL-E 3) and adds a cookie"""
        cookie = {"name": "_U", "value": self.cookie_value}
        webQuery = "https://www.bing.com/search?iscopilotedu=1&sendquery=1&q=" + query + "&form=MA13G9&showconv=1"

        options = ChromeOptions()
        options.add_argument("--disable-blink-features=AutomationControlled")
        options.add_argument("--headless")
        driver = Chrome(options=options)
        driver.get(webQuery)

        logging.info("Bing Image Creator (Dalle-3) Opened")
        driver.add_cookie(cookie)
        driver.refresh()
        logging.info("Cookie values added ")
        return True
    
    def get_urls(self, imagesPerPrompt = 4):
        """Extracts and returns image URLs from the website"""
        if imagesPerPrompt not in range (1, 5):
            raise ValueError("picturesPerSet argument must be between 1 and 4. Thanks!")
        
        cookie = {"name": "_U", "value": self.cookie_value}
        listenerQuery = "https://www.bing.com/images/create"
        self.driver.get(listenerQuery)
        self.driver.add_cookie(cookie)
        self.driver.refresh()
        button_id = "gil_n_rc"  # "Creations" button on create page"
        # button_class = "gir_attr_lnk" # Generated link after images are created on bing chat.

        try:
            # Find the button by its ID
            button = self.driver.find_element(By.ID, button_id)
            # button = WebDriverWait(self.driver, 60).until(
            #     EC.presence_of_element_located((By.CLASS_NAME, button_class)))
            button.click()
        except Exception as e:
            print(f"Error")
        
        # Get new image sets.
        newImageSets = set(
            element.get_attribute("href")
            for element in WebDriverWait(self.driver, 20).until(
                EC.presence_of_all_elements_located((By.CLASS_NAME, "girr_set "))
            )
        )
        newImageSets.update(set(
            element.get_attribute("href")
            for element in WebDriverWait(self.driver, 20).until(
                EC.presence_of_all_elements_located((By.CLASS_NAME, "girr_set.seled"))
            )
        ))
        # Remove old image sets.
        newImageSets.difference_update(self.originalImageSets) 

        allURLS = list()

        for imageSet in newImageSets:
            self.driver.get(imageSet)
            try:
                urls = list(
                    set(
                        [
                            element.get_attribute("src")
                            for element in WebDriverWait(self.driver, 60).until(
                                EC.presence_of_all_elements_located((By.CLASS_NAME, "mimg"))
                            )
                        ]
                    )
                )

                urls = [url.split("?")[0] for url in urls]
                allURLS.extend(urls[:imagesPerPrompt])
                # return urls
            
            except Exception as e:
                logging.critical(
                    f"Error while extracting image urls. Maybe something is wrong about your prompt. (You can check you prompt manually) \n{e}"
                )
        return allURLS
        
    def run(self, query):
        """
        Run the whole process of downloading images from the provided query

        Parameters
        ----------
        query : str
            the query to search for
        
        Usage:
        ------

        # Import the necessary module
        import logging
        from dalle3 import Dalle

        # Set up logging
        logging.basicConfig(level=logging.INFO)

        # Instantiate the Dalle class with your cookie value
        dalle = Dalle("")

        # Run the whole process of downloading images from the provided query
        dalle.run("Fish hivemind swarm in light blue avatar anime in zen garden pond concept art anime art, happy fish, anime scenery")
        
        """
        query = self.create(query)
        urls = self.get_urls()
        download = self.download(urls, "images/")
        return download
    
    